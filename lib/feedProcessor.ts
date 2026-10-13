import { sql } from '@/lib/db';
import { findVariantsBySkus, setInventoryLevel, setInventoryLevelsBatch } from '@/lib/shopify';

// Cuántos productos se procesan juntos: 1 consulta para buscarlos, 1 llamada para
// escribir sus cantidades y 1 escritura en la base de datos por cada bloque.
const CHUNK_SIZE = 50;

/** Recalcula los contadores de una carga y la marca "completada" si ya no hay pendientes. */
export async function refreshUploadCounts(uploadId: number) {
  const counts = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'success')   AS success,
      COUNT(*) FILTER (WHERE status = 'not_found') AS not_found,
      COUNT(*) FILTER (WHERE status = 'error')     AS error,
      COUNT(*) FILTER (WHERE status = 'pending')   AS pending
    FROM upload_items WHERE upload_id = ${uploadId}
  `;
  const c: any = counts[0];

  if (Number(c.pending) === 0) {
    await sql`
      UPDATE uploads
      SET success_count = ${c.success}, not_found_count = ${c.not_found}, error_count = ${c.error},
          status = 'completed', finished_at = NOW()
      WHERE id = ${uploadId}
    `;
  } else {
    await sql`
      UPDATE uploads
      SET success_count = ${c.success}, not_found_count = ${c.not_found}, error_count = ${c.error}
      WHERE id = ${uploadId}
    `;
  }
}

type PendingItem = {
  item_id: number;
  sku: string;
  requested_qty: number;
  upload_id: number;
  store_id: number;
  location_id: number;
  feed_id: number | null;
};

type Outcome = {
  item: PendingItem;
  status: 'success' | 'not_found' | 'error';
  message: string;
  title: string;
  remember: boolean; // ¿guardar en feed_snapshot?
};

/** Guarda en la base los resultados de todo un bloque con UNA sola escritura. */
async function saveOutcomes(outcomes: Outcome[]) {
  if (outcomes.length === 0) return;

  const ids = outcomes.map((o) => o.item.item_id);
  const statuses = outcomes.map((o) => o.status);
  const messages = outcomes.map((o) => o.message);
  const titles = outcomes.map((o) => o.title);
  await sql`
    UPDATE upload_items ui
    SET status = v.status, message = v.message, product_title = NULLIF(v.title, '')
    FROM UNNEST(${ids}::int[], ${statuses}::text[], ${messages}::text[], ${titles}::text[]) AS v(id, status, message, title)
    WHERE ui.id = v.id
  `;

  // Cantidad aplicada por SKU, para que la siguiente lectura solo envíe lo que cambió.
  const byFeed = new Map<number, { sku: string; qty: number }[]>();
  for (const o of outcomes) {
    if (!o.remember || !o.item.feed_id) continue;
    if (!byFeed.has(o.item.feed_id)) byFeed.set(o.item.feed_id, []);
    byFeed.get(o.item.feed_id)!.push({ sku: o.item.sku, qty: o.item.requested_qty });
  }
  for (const [feedId, rows] of byFeed) {
    const skus = rows.map((r) => r.sku);
    const qtys = rows.map((r) => r.qty);
    try {
      await sql`
        INSERT INTO feed_snapshot (feed_id, sku_key, sku, qty, updated_at)
        SELECT ${feedId}, lower(s), s, q, NOW()
        FROM UNNEST(${skus}::text[], ${qtys}::int[]) AS t(s, q)
        ON CONFLICT (feed_id, sku_key) DO UPDATE
          SET qty = EXCLUDED.qty, sku = EXCLUDED.sku, updated_at = NOW()
      `;
    } catch (e) {
      // Si la migración de feed_snapshot aún no se corrió, no rompemos el procesamiento.
      console.error('No se pudo guardar feed_snapshot:', e);
    }
  }
}

/** Procesa un grupo de productos de la misma tienda y sucursal. */
async function processGroup(
  store: { shop_domain: string; access_token: string; api_version: string },
  locationId: number,
  items: PendingItem[]
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const fail = (item: PendingItem, message: string, title = ''): Outcome => ({
    item, status: 'error', message, title, remember: false,
  });

  // 1) Buscar todos los SKU de golpe (y su cantidad actual en la sucursal)
  const lookup = await findVariantsBySkus(store, items.map((i) => i.sku), locationId);
  if (!lookup.ok) {
    return items.map((i) => fail(i, 'Error buscando SKU: ' + lookup.error));
  }

  const toBatch: { item: PendingItem; inventoryItemId: number; title: string; current: number }[] = [];
  const individual: { item: PendingItem; inventoryItemId: number; title: string; current: number }[] = [];

  for (const item of items) {
    const v = lookup.results.get(item.sku.toLowerCase());
    if (!v || !v.found) {
      outcomes.push({ item, status: 'not_found', message: 'SKU no encontrado en la tienda', title: '', remember: true });
    } else if (v.currentQuantity === item.requested_qty) {
      // Shopify ya tiene exactamente esa cantidad: no hace falta escribir nada.
      outcomes.push({
        item, status: 'success', title: v.productTitle, remember: true,
        message: `Sin cambios (ya tenía ${item.requested_qty})`,
      });
    } else if (!v.stocked) {
      // Aún no está conectado a esa sucursal: va uno por uno (ahí se activa).
      individual.push({ item, inventoryItemId: v.inventoryItemId, title: v.productTitle, current: v.currentQuantity });
    } else {
      toBatch.push({ item, inventoryItemId: v.inventoryItemId, title: v.productTitle, current: v.currentQuantity });
    }
  }

  // 2) Escribir todas las cantidades en una sola llamada
  if (toBatch.length > 0) {
    const results = await setInventoryLevelsBatch(
      store,
      locationId,
      toBatch.map((b) => ({
        inventoryItemId: b.inventoryItemId,
        quantity: b.item.requested_qty,
        changeFromQuantity: b.current,
      }))
    );
    toBatch.forEach((b, idx) => {
      const r = results[idx];
      if (r.ok) {
        outcomes.push({
          item: b.item, status: 'success', title: b.title, remember: true,
          message: `Inventario actualizado a ${b.item.requested_qty}`,
        });
      } else if (r.needsIndividual) {
        individual.push(b);
      } else {
        outcomes.push(fail(b.item, `Error al actualizar: ${r.error}`, b.title));
      }
    });
  }

  // 3) Los casos especiales (sin conectar a la sucursal, o lote que no se pudo atribuir) uno por uno
  for (const b of individual) {
    const r = await setInventoryLevel(store, locationId, b.inventoryItemId, b.item.requested_qty, b.current);
    if (r.ok) {
      outcomes.push({
        item: b.item, status: 'success', title: b.title, remember: true,
        message: `Inventario actualizado a ${b.item.requested_qty}`,
      });
    } else {
      outcomes.push(fail(b.item, `Error al actualizar: ${r.error}`, b.title));
    }
  }

  return outcomes;
}

/**
 * Procesa filas pendientes contra Shopify hasta agotar `maxDurationMs` o hasta que
 * ya no quede nada pendiente (lo que pase primero). Trabaja por bloques de 50.
 */
export async function processPendingBatch(maxDurationMs: number): Promise<{ processed: number; hasMore: boolean }> {
  const startedAt = Date.now();
  let processed = 0;
  const touchedUploadIds = new Set<number>();

  const storeCache = new Map<number, any>();
  async function getStore(storeId: number) {
    if (storeCache.has(storeId)) return storeCache.get(storeId);
    const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
    const store = rows[0];
    storeCache.set(storeId, store);
    return store;
  }

  while (Date.now() - startedAt < maxDurationMs) {
    const pending = (await sql`
      SELECT ui.id AS item_id, ui.sku, ui.requested_qty, ui.upload_id,
             u.store_id, u.location_id, u.feed_id
      FROM upload_items ui
      JOIN uploads u ON u.id = ui.upload_id
      WHERE ui.status = 'pending'
      ORDER BY ui.id
      LIMIT ${CHUNK_SIZE}
    `) as PendingItem[];

    if (pending.length === 0) break;

    // Si un SKU viene repetido en el bloque, solo se procesa la primera aparición;
    // las demás se quedan pendientes para el siguiente bloque.
    const seen = new Set<string>();
    const work = pending.filter((p) => {
      const k = `${p.store_id}:${p.location_id}:${p.sku.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Agrupar por tienda y sucursal
    const groups = new Map<string, PendingItem[]>();
    for (const p of work) {
      const key = `${p.store_id}:${p.location_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const outcomes: Outcome[] = [];
    for (const items of groups.values()) {
      const storeRow = await getStore(items[0].store_id);
      if (!storeRow) {
        for (const item of items) {
          outcomes.push({ item, status: 'error', message: 'Tienda no encontrada', title: '', remember: false });
        }
        continue;
      }
      const store = {
        shop_domain: storeRow.shop_domain,
        access_token: storeRow.access_token,
        api_version: storeRow.api_version,
      };
      outcomes.push(...(await processGroup(store, items[0].location_id, items)));
    }

    await saveOutcomes(outcomes);
    for (const o of outcomes) touchedUploadIds.add(o.item.upload_id);
    processed += outcomes.length;
  }

  for (const uploadId of touchedUploadIds) {
    await refreshUploadCounts(uploadId);
  }

  const remainingRows = await sql`SELECT COUNT(*)::int AS c FROM upload_items WHERE status = 'pending'`;
  const hasMore = (remainingRows[0] as any).c > 0;

  return { processed, hasMore };
}
