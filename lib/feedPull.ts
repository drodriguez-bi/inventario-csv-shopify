import { sql } from '@/lib/db';
import { fetchRemoteCsv } from '@/lib/ftpFetch';
import { parseInventoryCsv } from '@/lib/csvParse';
import { refreshUploadCounts } from '@/lib/feedProcessor';

export type PullResult = {
  ok: boolean;
  status: string;      // texto legible, también se guarda en feeds.last_pull_status
  totalRows?: number;
  queued?: number;
  unchanged?: number;
  uploadId?: number;
};

async function saveStatus(feedId: number, status: string) {
  await sql`UPDATE feeds SET last_pulled_at = NOW(), last_pull_status = ${status} WHERE id = ${feedId}`;
}

/**
 * Lee el archivo del FTP/SFTP del proveedor y encola SOLO los SKU cuya cantidad
 * cambió respecto a lo último que se aplicó en Shopify.
 */
export async function pullFeed(feed: any): Promise<PullResult> {
  // 1) Descargar
  let remote: { filename: string; text: string };
  try {
    remote = await fetchRemoteCsv({
      protocol: (feed.ftp_protocol || 'ftp') as 'ftp' | 'ftps' | 'sftp',
      host: feed.ftp_host,
      port: feed.ftp_port,
      user: feed.ftp_user,
      password: feed.ftp_password,
      path: feed.ftp_path,
    });
  } catch (e: any) {
    const status = `Error al conectar/descargar: ${e?.message || e}`;
    await saveStatus(feed.id, status);
    return { ok: false, status };
  }

  // 2) Leer y validar
  const parsed = parseInventoryCsv(remote.text);
  if (!parsed.ok) {
    const status = `Archivo "${remote.filename}" no válido: ${parsed.error}`;
    await saveStatus(feed.id, status);
    return { ok: false, status };
  }
  const rows = parsed.rows;

  // 3) Comparar contra lo último aplicado
  const snapRows = await sql`SELECT sku_key, qty FROM feed_snapshot WHERE feed_id = ${feed.id}`;
  const snapshot = new Map<string, number>();
  for (const r of snapRows as any[]) snapshot.set(r.sku_key, r.qty);

  const delta = rows.filter((r) => snapshot.get(r.sku.toLowerCase()) !== r.qty);
  const deltaByKey = new Map(delta.map((r) => [r.sku.toLowerCase(), r]));

  // 4) Reconciliar con lo que ya está en cola (pendiente) de este feed
  const pending = (await sql`
    SELECT ui.id, ui.sku, ui.requested_qty, ui.upload_id
    FROM upload_items ui JOIN uploads u ON u.id = ui.upload_id
    WHERE u.feed_id = ${feed.id} AND ui.status = 'pending'
  `) as any[];

  const stale = pending.filter((p) => deltaByKey.get(p.sku.toLowerCase())?.qty !== p.requested_qty);
  const stillPending = new Set(
    pending
      .filter((p) => deltaByKey.get(p.sku.toLowerCase())?.qty === p.requested_qty)
      .map((p) => p.sku.toLowerCase())
  );
  const toQueue = delta.filter((r) => !stillPending.has(r.sku.toLowerCase()));

  if (stale.length > 0) {
    const ids = stale.map((s) => s.id);
    await sql`
      UPDATE upload_items
      SET status = 'superseded', message = 'Reemplazado por una lectura más reciente del archivo'
      WHERE id = ANY(${ids}::int[])
    `;
    for (const uploadId of new Set(stale.map((s) => s.upload_id as number))) {
      await refreshUploadCounts(uploadId);
    }
  }

  // 5) Encolar los cambios
  let uploadId: number | undefined;
  if (toQueue.length > 0) {
    const up = await sql`
      INSERT INTO uploads (user_id, store_id, location_id, location_name, filename, total_rows, status, source, feed_id)
      VALUES (NULL, ${feed.store_id}, ${feed.location_id}, ${feed.location_name}, ${remote.filename},
              ${toQueue.length}, 'processing', 'feed', ${feed.id})
      RETURNING id
    `;
    uploadId = up[0].id as number;
    const skus = toQueue.map((r) => r.sku);
    const qtys = toQueue.map((r) => r.qty);
    await sql`
      INSERT INTO upload_items (upload_id, sku, requested_qty, status)
      SELECT ${uploadId}, s, q, 'pending'
      FROM UNNEST(${skus}::text[], ${qtys}::int[]) AS t(s, q)
      ON CONFLICT DO NOTHING
    `;
  }

  const unchanged = rows.length - delta.length;
  let status: string;
  if (toQueue.length > 0) {
    status = `"${remote.filename}": ${rows.length} filas, ${toQueue.length} con cambios en cola, ${unchanged} sin cambios`;
  } else if (stillPending.size > 0) {
    status = `"${remote.filename}": ${rows.length} filas, ${stillPending.size} aún en proceso de la lectura anterior`;
  } else {
    status = `"${remote.filename}": ${rows.length} filas, sin cambios desde la última lectura`;
  }
  await saveStatus(feed.id, status);
  console.log(JSON.stringify({ evento: 'pullFeed', feed: feed.id, filas: rows.length, enCola: toQueue.length, sinCambios: unchanged, reemplazados: stale.length, uploadId: uploadId ?? null }));

  return { ok: true, status, totalRows: rows.length, queued: toQueue.length, unchanged, uploadId };
}
