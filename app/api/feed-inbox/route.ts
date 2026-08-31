import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ingestFeedFile } from '@/lib/feedIngest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Endpoint alterno, pensado para cuando el proveedor tiene su propio sistema
// (no una persona con el mouse). En vez de llevar el token en la URL, se manda
// como header Authorization — más estándar para integraciones API-a-API.
//
// Cómo lo usa el proveedor:
//   POST https://tu-dominio.vercel.app/api/feed-inbox
//   Authorization: Bearer TU_TOKEN_DE_FEED
//   Content-Type: text/csv  (o multipart/form-data con un campo "file")
//   Body: el CSV

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Falta el header Authorization: Bearer {token}.' },
      { status: 401 }
    );
  }

  const feedRows = await sql`SELECT * FROM feeds WHERE token = ${token}`;
  const feed = feedRows[0];

  if (!feed) {
    return NextResponse.json({ ok: false, error: 'Token no válido.' }, { status: 401 });
  }

  const result = await ingestFeedFile(req, feed as any);

  if (!result.ok) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
