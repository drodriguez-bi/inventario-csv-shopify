import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Los permisos que necesita el sistema para leer/escribir inventario
const SCOPES = 'read_products,read_locations,read_inventory,write_inventory';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) {
    return NextResponse.json({ ok: false, error: 'storeId requerido' }, { status: 400 });
  }

  const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
  const store = rows[0];

  if (!store) {
    return NextResponse.json({ ok: false, error: 'Tienda no encontrada' }, { status: 404 });
  }
  if (!store.client_id || !store.client_secret) {
    return NextResponse.json(
      { ok: false, error: 'Esta tienda no tiene configurado Client ID / Client Secret todavía.' },
      { status: 400 }
    );
  }

  // "state" evita que alguien más complete este flujo por su cuenta (CSRF)
  const state = crypto.randomBytes(16).toString('hex');
  await sql`UPDATE stores SET oauth_state = ${state} WHERE id = ${storeId}`;

  const redirectUri = `${req.nextUrl.origin}/api/shopify/callback`;

  const authorizeUrl =
    `https://${store.shop_domain}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(store.client_id)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(authorizeUrl);
}
