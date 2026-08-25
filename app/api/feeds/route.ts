import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rows = await sql`
    SELECT f.id, f.name, f.token, f.location_name, f.created_at,
           s.id AS store_id, s.name AS store_name
    FROM feeds f
    JOIN stores s ON s.id = f.store_id
    ORDER BY f.created_at DESC
  `;
  return NextResponse.json({ ok: true, feeds: rows });
}

export async function POST(req: NextRequest) {
  const { name, store_id, location_id, location_name } = await req.json();

  if (!name?.trim() || !store_id || !location_id) {
    return NextResponse.json({ ok: false, error: 'Nombre, tienda y sucursal son obligatorios.' }, { status: 400 });
  }

  const token = crypto.randomBytes(24).toString('hex');

  const rows = await sql`
    INSERT INTO feeds (name, store_id, location_id, location_name, token)
    VALUES (${name.trim()}, ${store_id}, ${location_id}, ${location_name ?? ''}, ${token})
    RETURNING id
  `;

  return NextResponse.json({ ok: true, feedId: rows[0].id, token });
}
