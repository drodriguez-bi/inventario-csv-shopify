import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rows = await sql`
    SELECT id, name, shop_domain, api_version,
           (access_token IS NOT NULL) AS connected
    FROM stores
    ORDER BY name
  `;
  return NextResponse.json({ ok: true, stores: rows });
}

export async function POST(req: NextRequest) {
  const { name, shop_domain, client_id, client_secret, api_version } = await req.json();

  let domain = (shop_domain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const version = (api_version || '').trim() || '2025-10';

  if (!name?.trim() || !domain || !client_id?.trim() || !client_secret?.trim()) {
    return NextResponse.json({ ok: false, error: 'Todos los campos son obligatorios.' }, { status: 400 });
  }
  if (!domain.endsWith('.myshopify.com')) {
    return NextResponse.json(
      { ok: false, error: 'El dominio debe terminar en .myshopify.com (ej: stanley-1913-mx.myshopify.com)' },
      { status: 400 }
    );
  }

  const rows = await sql`
    INSERT INTO stores (name, shop_domain, client_id, client_secret, api_version)
    VALUES (${name.trim()}, ${domain}, ${client_id.trim()}, ${client_secret.trim()}, ${version})
    RETURNING id
  `;

  return NextResponse.json({ ok: true, storeId: rows[0].id });
}
