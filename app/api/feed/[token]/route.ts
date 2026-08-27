import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { processPendingBatch } from '@/lib/feedProcessor';
import Papa from 'papaparse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cuánto tiempo procesamos AL INSTANTE, en la misma petición en la que
// llega el archivo, antes de responder. El resto (si el archivo es más
// grande) lo va terminando el cron / el disparador externo en los minutos
// siguientes — el límite real de velocidad lo pone la propia API de Shopify,
// no nuestro sistema.
const INSTANT_PROCESSING_MS = 45_000;

// Este es "el servidor" al que un proveedor (Gifan u otro) sube su inventario.
// No requiere login — el propio link (con su token único) es la protección.
//
// Cómo lo usa el proveedor:
//   POST https://tu-dominio.vercel.app/api/feed/{token}
//   Content-Type: text/csv  (o multipart/form-data con un campo "file")
//   Body: el CSV

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;

  const feedRows = await sql`SELECT * FROM feeds WHERE token = ${token}`;
  const feed = feedRows[0];

  if (!feed) {
    return NextResponse.json({ ok: false, error: 'Link no válido.' }, { status: 404 });
  }

  let csvText: string;
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'No se encontró el archivo (campo "file").' }, { status: 400 });
    }
    csvText = await file.text();
  } else {
    csvText = await req.text();
  }

  if (!csvText || csvText.trim() === '') {
    return NextResponse.json({ ok: false, error: 'El cuerpo de la petición está vacío.' }, { status: 400 });
  }

  // Quita el BOM (marca invisible que a veces agrega Excel/Google Sheets al
  // exportar CSV) si viene al inicio del archivo.
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
    return NextResponse.json(
      {
        ok: false,
        error:
          'El CSV debe tener una columna de SKU ("sku" o "Item-number") y una de cantidad ("cantidad", "quantity", "qty" o "Ubicado").',
        detected_columns: fields,
      },
      { status: 400 }
    );
  }

  const rows = (parsed.data as Record<string, string>[])
    .map((row) => ({
      sku: String(row[skuKey] ?? '').trim(),
      qty: parseInt(String(row[qtyKey] ?? '0'), 10) || 0,
    }))
    .filter((r) => r.sku !== '');

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'El CSV no contiene filas válidas.' }, { status: 400 });
  }

  const uploadRows = await sql`
    INSERT INTO uploads (user_id, store_id, location_id, location_name, filename, total_rows, status, source, feed_id)
    VALUES (
      NULL, ${feed.store_id}, ${feed.location_id}, ${feed.location_name}, ${feed.name + '.csv'},
      ${rows.length}, 'processing', 'feed', ${feed.id}
    )
    RETURNING id
  `;
  const uploadId = uploadRows[0].id;

  // Una sola inserción masiva (en vez de una por fila) para que archivos
  // grandes (cientos/miles de filas) no tarden en quedar en cola.
  const skus = rows.map((r) => r.sku);
  const qtys = rows.map((r) => r.qty);
  await sql`
    INSERT INTO upload_items (upload_id, sku, requested_qty, status)
    SELECT ${uploadId}, s, q, 'pending'
    FROM UNNEST(${skus}::text[], ${qtys}::int[]) AS t(s, q)
  `;

  // Procesamos el primer bloque AL INSTANTE, antes de responder — así el
  // proveedor ve resultados de inmediato, en vez de esperar al cron.
  const firstBatch = await processPendingBatch(INSTANT_PROCESSING_MS);

  return NextResponse.json({
    ok: true,
    message: firstBatch.hasMore
      ? `Archivo recibido. Se procesaron ${firstBatch.processed} filas al instante; el resto se completa en los próximos minutos.`
      : `Archivo recibido y procesado por completo (${firstBatch.processed} filas).`,
    uploadId,
    totalRows: rows.length,
    processedInstantly: firstBatch.processed,
  });
}
