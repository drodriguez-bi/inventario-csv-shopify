import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
  const rows = await sql`SELECT id, name, shop_domain, api_version FROM stores ORDER BY name`;
  return NextResponse.json({ ok: true, stores: rows });
}

export async function POST(req: NextRequest) {
  const { name, shop_domain, access_token, api_version } = await req.json();

  let domain = (shop_domain || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const version = (api_version || '').trim() || '2024-01';

  if (!name?.trim() || !domain || !access_token?.trim()) {
    return NextResponse.json({ ok: false, error: 'Todos los campos son obligatorios.' }, { status: 400 });
  }
  if (!domain.endsWith('.myshopify.com')) {
    return NextResponse.json(
      { ok: false, error: 'El dominio debe terminar en .myshopify.com (ej: stanley-1913-mx.myshopify.com)' },
      { status: 400 }
    );
  }

  await sql`
    INSERT INTO stores (name, shop_domain, access_token, api_version)
    VALUES (${name.trim()}, ${domain}, ${access_token.trim()}, ${version})
  `;

  return NextResponse.json({ ok: true });
}
