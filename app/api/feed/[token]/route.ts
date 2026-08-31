import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ingestFeedFile } from '@/lib/feedIngest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Este es "el servidor" al que un proveedor (Gifan u otro) sube su inventario.
// No requiere login — el propio link (con su token único) es la protección.
// Pensado para: la página amigable (/feed/{token}) o pruebas rápidas con curl.
//
// Cómo lo usa el proveedor:
//   POST https://tu-dominio.vercel.app/api/feed/{token}
//   Content-Type: text/csv  (o multipart/form-data con un campo "file")
//   Body: el CSV

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;

  const rows = await sql`
    SELECT f.name, s.name AS store_name, f.location_name
    FROM feeds f JOIN stores s ON s.id = f.store_id
    WHERE f.token = ${token}
  `;
  const feed = rows[0];

  if (!feed) {
    return NextResponse.json({ ok: false, error: 'Link no válido.' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    name: feed.name,
    storeName: feed.store_name,
    locationName: feed.location_name,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const token = params.token;

  const feedRows = await sql`SELECT * FROM feeds WHERE token = ${token}`;
  const feed = feedRows[0];

  if (!feed) {
    return NextResponse.json({ ok: false, error: 'Link no válido.' }, { status: 404 });
  }

  const result = await ingestFeedFile(req, feed as any);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
