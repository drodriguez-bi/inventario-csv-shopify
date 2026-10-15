import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { testConnection } from '@/lib/shopify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Botón "Probar conexión" de la pantalla Tiendas. Requiere sesión (lo protege el middleware).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const rows = await sql`SELECT * FROM stores WHERE id = ${id}`;
  const store = rows[0] as any;
  if (!store) {
    return NextResponse.json({ ok: false, message: 'Tienda no encontrada.' }, { status: 404 });
  }

  if (!store.access_token || String(store.access_token).trim() === '') {
    return NextResponse.json({
      ok: false,
      kind: 'sin_token',
      message:
        'Esta tienda no tiene token guardado: la conexión con Shopify nunca se completó. ' +
        'Dale "Conectar con Shopify" y autoriza la app.',
    });
  }

  let result;
  try {
    result = await testConnection({
      shop_domain: store.shop_domain,
      access_token: store.access_token,
      api_version: store.api_version,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      kind: 'sin_conexion',
      message: `No se pudo contactar a ${store.shop_domain}. Revisa que el dominio esté bien escrito. (${e?.message || e})`,
    });
  }

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      message: `Funciona. Shopify respondió con la tienda "${result.shopName}" y ${result.locationCount} sucursal(es).`,
    });
  }
  if (result.kind === 'rejected') {
    return NextResponse.json({
      ok: false,
      kind: 'rechazado',
      message:
        'Shopify rechazó el token guardado. Dale "Reconectar". Si sigue igual, revisa que la app esté instalada ' +
        'en esa tienda y que el Client ID y Client Secret sean de esa misma app.',
    });
  }
  if (result.kind === 'missing_scope') {
    return NextResponse.json({
      ok: false,
      kind: 'falta_permiso',
      message:
        `El token sirve, pero falta un permiso: ${result.message}. Revisa que la app tenga ` +
        'read_products, read_locations, read_inventory y write_inventory, y dale "Reconectar".',
    });
  }
  return NextResponse.json({ ok: false, kind: 'otro', message: `Shopify respondió con un error: ${result.message}` });
}
