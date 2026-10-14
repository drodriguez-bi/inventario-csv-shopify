import Papa from 'papaparse';

export const MAX_ROWS_PER_FILE = 20_000;

const SKU_NAMES = ['sku', 'item-number', 'item number', 'itemnumber'];
const QTY_NAMES = ['cantidad', 'quantity', 'qty', 'ubicado'];

export type ParsedInventory =
  | {
      ok: true;
      rows: { sku: string; qty: number }[];
      skippedInvalidQty: number;
      duplicatesCollapsed: number;
      hadHeader: boolean;
    }
  | { ok: false; status: number; error: string; detected_columns?: string[] };

function clean(cell: unknown): string {
  return String(cell ?? '').replace(/^\uFEFF/, '').trim();
}

/**
 * Lee un CSV de inventario. Acepta dos formatos:
 *  1) Con encabezados: columnas "sku"/"Item-number" y "cantidad"/"quantity"/"qty"/"Ubicado".
 *  2) Sin encabezados: 2 columnas, la primera es el SKU y la segunda la cantidad
 *     (ej.  "00090PT",143).
 */
export function parseInventoryCsv(csvText: string): ParsedInventory {
  const text = csvText.replace(/^\uFEFF/, '').trim();

  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  const table = (parsed.data as string[][]).filter((r) => r.some((c) => clean(c) !== ''));

  if (table.length === 0) {
    return { ok: false, status: 400, error: 'El archivo está vacío.' };
  }

  const first = table[0].map((c) => clean(c).toLowerCase());
  let skuIdx = first.findIndex((c) => SKU_NAMES.includes(c));
  let qtyIdx = first.findIndex((c) => QTY_NAMES.includes(c));
  let dataRows: string[][];
  let hadHeader = true;

  if (skuIdx !== -1 && qtyIdx !== -1) {
    dataRows = table.slice(1);
  } else if (first.length >= 2 && first[0] !== '' && /^-?\d+$/.test(first[1])) {
    // Sin encabezados: primera columna = SKU, segunda = cantidad
    skuIdx = 0;
    qtyIdx = 1;
    dataRows = table;
    hadHeader = false;
  } else {
    return {
      ok: false,
      status: 400,
      error:
        'No se reconoció el formato. Se esperan columnas de SKU ("sku" o "Item-number") y cantidad ("cantidad", "quantity", "qty" o "Ubicado"), o un archivo de 2 columnas sin encabezado (SKU, cantidad).',
      detected_columns: first,
    };
  }

  const rawRows = dataRows
    .map((r) => ({ sku: clean(r[skuIdx]), qtyRaw: clean(r[qtyIdx]) }))
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

  let skippedInvalidQty = 0;
  const validRows: { sku: string; qty: number }[] = [];
  for (const r of rawRows) {
    const qty = parseInt(r.qtyRaw, 10);
    if (isNaN(qty) || qty < 0) {
      skippedInvalidQty++;
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

  // Si un SKU se repite, gana la última aparición
  const seen = new Map<string, { sku: string; qty: number }>();
  for (const r of validRows) seen.set(r.sku.toLowerCase(), r);
  const rows = Array.from(seen.values());

  return {
    ok: true,
    rows,
    skippedInvalidQty,
    duplicatesCollapsed: validRows.length - rows.length,
    hadHeader,
  };
}
