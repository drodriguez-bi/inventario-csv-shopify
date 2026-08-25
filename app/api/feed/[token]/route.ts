import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import Papa from 'papaparse';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Este es "el servidor" al que un proveedor (Gifan u otro) sube su inventario.
// No requiere login — el propio link (con su token único) es la protección.
//
// Cómo lo usa el proveedor:
//   POST https://tu-dominio.vercel.app/api/feed/{token}
//   Content-Type: text/csv  (o multipart/form-data con un campo "file")
//   Body: el CSV
//
// El archivo NO se procesa al instante contra Shopify: se guarda como
// "pendiente" y una tarea programada (cron) lo va procesando en segundo plano.

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

  const parsed = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  const fields = (parsed.meta.fields || []).map((f) => f.trim().toLowerCase());
  const skuKey = fields.find((f) => ['sku', 'item-number', 'item number', 'itemnumber'].includes(f));
  const qtyKey = fields.find((f) => ['cantidad', 'quantity', 'qty', 'ubicado'].includes(f));

  if (!skuKey || !qtyKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'El CSV debe tener una columna de SKU ("sku" o "Item-number") y una de cantidad ("cantidad", "quantity", "qty" o "Ubicado").',
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

  for (const r of rows) {
    await sql`
      INSERT INTO upload_items (upload_id, sku, requested_qty, status)
      VALUES (${uploadId}, ${r.sku}, ${r.qty}, 'pending')
    `;
  }

  return NextResponse.json({
    ok: true,
    message: 'Archivo recibido. Se procesará en los próximos minutos.',
    uploadId,
    totalRows: rows.length,
  });
}
