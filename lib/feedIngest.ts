import { sql } from '@/lib/db';
import { processPendingBatch } from '@/lib/feedProcessor';
import Papa from 'papaparse';

const INSTANT_PROCESSING_MS = 45_000;
const MAX_ROWS_PER_FILE = 20_000; // límite de cordura, evita archivos absurdamente grandes por error

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
 * Recibe el archivo (CSV crudo o multipart/form-data), lo valida, lo encola,
 * y procesa el primer bloque al instante. Compartido por las dos formas de
 * autenticación (token en la URL y token en header Authorization).
 */
export async function ingestFeedFile(req: Request, feed: FeedRow): Promise<IngestResult> {
  const contentType = req.headers.get('content-type') || '';

  // --- Validación de tipo de archivo ---------------------------------
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

  // Quita el BOM (marca invisible que a veces agrega Excel/Google Sheets al exportar CSV)
  csvText = csvText.replace(/^\uFEFF/, '');

  const parsed = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.replace(/^\uFEFF/, '').trim().toLowerCase(),
  });

  const fields = (parsed.meta.fields || []).map((f) => f.replace(/^\uFEFF/, '').trim().toLowerCase());
  const skuKey = fields.find((f) => ['sku', 'item-number', 'item number', 'itemnumber'].includes(f));
  const qtyKey = fields.find((f) => ['cantidad', 'quantity', 'qty', 'ubicado'].includes(f));

  if (!skuKey || !qtyKey) {
    return {
      ok: false,
      status: 400,
      error:
        'El CSV debe tener una columna de SKU ("sku" o "Item-number") y una de cantidad ("cantidad", "quantity", "qty" o "Ubicado").',
      detected_columns: fields,
    };
  }

  const rawRows = (parsed.data as Record<string, string>[])
    .map((row) => ({
      sku: String(row[skuKey] ?? '').trim(),
      qtyRaw: String(row[qtyKey] ?? '').trim(),
    }))
    .filter((r) => r.sku !== '');

  if (rawRows.length === 0) {
    return { ok: false, status: 400, error: 'El CSV no contiene filas válidas.' };
  }

  if (rawRows.length > MAX_ROWS_PER_FILE) {
    return {
      ok: false,
      status: 413,
      error: `El archivo trae ${rawRows.length} filas, más del máximo permitido (${MAX_ROWS_PER_FILE}). Verifica que sea el archivo correcto.`,
    };
  }

  // --- Validación de cantidades: rechaza negativas, no las guarda en 0 silenciosamente ---
  let skippedNegativeQty = 0;
  const validRows: { sku: string; qty: number }[] = [];
  for (const r of rawRows) {
    const qty = parseInt(r.qtyRaw, 10);
    if (isNaN(qty) || qty < 0) {
      skippedNegativeQty++;
      continue;
    }
    validRows.push({ sku: r.sku, qty });
  }

  if (validRows.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Ninguna fila tiene una cantidad válida (0 o mayor). Revisa la columna de cantidad.',
    };
  }

  // --- Deduplicar por SKU: si se repite, se queda la última aparición ---
  const seen = new Map<string, { sku: string; qty: number }>();
  for (const r of validRows) {
    seen.set(r.sku.toLowerCase(), r); // la última aparición gana
  }
  const dedupedRows = Array.from(seen.values());
  const duplicatesCollapsed = validRows.length - dedupedRows.length;

  const uploadRows = await sql`
    INSERT INTO uploads (user_id, store_id, location_id, location_name, filename, total_rows, status, source, feed_id)
    VALUES (
      NULL, ${feed.store_id}, ${feed.location_id}, ${feed.location_name}, ${uploadedFilename},
      ${dedupedRows.length}, 'processing', 'feed', ${feed.id}
    )
    RETURNING id
  `;
  const uploadId = uploadRows[0].id;

  const skus = dedupedRows.map((r) => r.sku);
  const qtys = dedupedRows.map((r) => r.qty);
  await sql`
    INSERT INTO upload_items (upload_id, sku, requested_qty, status)
    SELECT ${uploadId}, s, q, 'pending'
    FROM UNNEST(${skus}::text[], ${qtys}::int[]) AS t(s, q)
  `;

  const firstBatch = await processPendingBatch(INSTANT_PROCESSING_MS);

  const notes: string[] = [];
  if (skippedNegativeQty > 0) notes.push(`${skippedNegativeQty} fila(s) con cantidad inválida fueron ignoradas`);
  if (duplicatesCollapsed > 0) notes.push(`${duplicatesCollapsed} SKU(s) duplicados (se usó la última aparición)`);

  const baseMessage = firstBatch.hasMore
    ? `Archivo recibido. Se procesaron ${firstBatch.processed} filas al instante; el resto se completa en los próximos minutos.`
    : `Archivo recibido y procesado por completo (${firstBatch.processed} filas).`;

  return {
    ok: true,
    message: notes.length > 0 ? `${baseMessage} (${notes.join('; ')}.)` : baseMessage,
    uploadId,
    totalRows: dedupedRows.length,
    processedInstantly: firstBatch.processed,
    skippedNegativeQty,
    duplicatesCollapsed,
  };
}
