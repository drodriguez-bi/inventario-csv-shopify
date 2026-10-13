import { sql } from '@/lib/db';
import { processPendingBatch } from '@/lib/feedProcessor';
import { parseInventoryCsv } from '@/lib/csvParse';

const INSTANT_PROCESSING_MS = 45_000;

export type FeedRow = {
  id: number;
  name: string;
  store_id: number;
  location_id: number;
  location_name: string;
};

export type IngestResult =
  | {
      ok: true;
      message: string;
      uploadId: number;
      totalRows: number;
      processedInstantly: number;
      skippedNegativeQty: number;
      duplicatesCollapsed: number;
    }
  | { ok: false; error: string; status: number; detected_columns?: string[] };

/**
 * Recibe el archivo que un proveedor SUBE (CSV crudo o multipart/form-data),
 * lo valida, lo encola, y procesa el primer bloque al instante.
 */
export async function ingestFeedFile(req: Request, feed: FeedRow): Promise<IngestResult> {
  const contentType = req.headers.get('content-type') || '';

  const allowedTypes = ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'];
  const isMultipart = contentType.includes('multipart/form-data');
  const isAllowedRawType = allowedTypes.some((t) => contentType.includes(t));

  if (!isMultipart && contentType && !isAllowedRawType) {
    return {
      ok: false,
      status: 415,
      error: `Tipo de contenido no permitido ("${contentType}"). Solo se aceptan archivos CSV (Content-Type: text/csv) o multipart/form-data.`,
    };
  }

  let csvText: string;
  let uploadedFilename = `${feed.name}.csv`;

  if (isMultipart) {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return { ok: false, status: 400, error: 'No se encontró el archivo (campo "file").' };
    }
    if (file.name && !file.name.toLowerCase().endsWith('.csv')) {
      return { ok: false, status: 415, error: `El archivo debe ser .csv (recibido: "${file.name}").` };
    }
    csvText = await file.text();
    if (file.name) uploadedFilename = file.name;
  } else {
    csvText = await req.text();
  }

  if (!csvText || csvText.trim() === '') {
    return { ok: false, status: 400, error: 'El cuerpo de la petición está vacío.' };
  }

  const parsed = parseInventoryCsv(csvText);
  if (!parsed.ok) {
    return { ok: false, status: parsed.status, error: parsed.error, detected_columns: parsed.detected_columns };
  }
  const rows = parsed.rows;

  const uploadRows = await sql`
    INSERT INTO uploads (user_id, store_id, location_id, location_name, filename, total_rows, status, source, feed_id)
    VALUES (
      NULL, ${feed.store_id}, ${feed.location_id}, ${feed.location_name}, ${uploadedFilename},
      ${rows.length}, 'processing', 'feed', ${feed.id}
    )
    RETURNING id
  `;
  const uploadId = uploadRows[0].id;

  const skus = rows.map((r) => r.sku);
  const qtys = rows.map((r) => r.qty);
  await sql`
    INSERT INTO upload_items (upload_id, sku, requested_qty, status)
    SELECT ${uploadId}, s, q, 'pending'
    FROM UNNEST(${skus}::text[], ${qtys}::int[]) AS t(s, q)
  `;

  const firstBatch = await processPendingBatch(INSTANT_PROCESSING_MS);

  const notes: string[] = [];
  if (parsed.skippedInvalidQty > 0) notes.push(`${parsed.skippedInvalidQty} fila(s) con cantidad inválida fueron ignoradas`);
  if (parsed.duplicatesCollapsed > 0) notes.push(`${parsed.duplicatesCollapsed} SKU(s) duplicados (se usó la última aparición)`);

  const baseMessage = firstBatch.hasMore
    ? `Archivo recibido. Se procesaron ${firstBatch.processed} filas al instante; el resto se completa en los próximos minutos.`
    : `Archivo recibido y procesado por completo (${firstBatch.processed} filas).`;

  return {
    ok: true,
    message: notes.length > 0 ? `${baseMessage} (${notes.join('; ')}.)` : baseMessage,
    uploadId,
    totalRows: rows.length,
    processedInstantly: firstBatch.processed,
    skippedNegativeQty: parsed.skippedInvalidQty,
    duplicatesCollapsed: parsed.duplicatesCollapsed,
  };
}
