import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

// Si algo falla antes de ir a Shopify, regresamos a Tiendas con el motivo visible.
function back(req: NextRequest, error: string) {
  return NextResponse.redirect(`${req.nextUrl.origin}/stores?error=${encodeURIComponent(error)}`);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Los permisos que necesita el sistema para leer/escribir inventario
const SCOPES = 'read_products,read_locations,read_inventory,write_inventory';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) {
    return back(req, 'Falta indicar qué tienda conectar.');
  }

  const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
  const store = rows[0];

  if (!store) {
    return back(req, 'No se encontró esa tienda.');
  }
  if (!store.client_id || !store.client_secret) {
    return back(req, 'Esta tienda no tiene Client ID / Client Secret guardados. Elimínala y vuelve a registrarla.');
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
