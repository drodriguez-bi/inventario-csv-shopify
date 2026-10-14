import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getLocations } from '@/lib/shopify';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const storeId = parseInt(req.nextUrl.searchParams.get('storeId') || '', 10);
  if (!storeId) {
    return NextResponse.json({ ok: false, error: 'storeId requerido', locations: [] }, { status: 400 });
  }

  const rows = await sql`SELECT * FROM stores WHERE id = ${storeId}`;
  const store = rows[0];
  if (!store) {
    return NextResponse.json({ ok: false, error: 'Tienda no encontrada', locations: [] }, { status: 404 });
  }

  // La tienda se dio de alta pero nunca se completó la conexión con Shopify
  if (!store.access_token) {
    return NextResponse.json({
      ok: false,
      locations: [],
      error:
        `La tienda "${store.name}" todavía no está conectada con Shopify. ` +
        'Ve a Tiendas y dale clic a "Conectar con Shopify".',
    });
  }

  const result = await getLocations({
    shop_domain: store.shop_domain,
    access_token: store.access_token,
    api_version: store.api_version,
  });

  // Shopify rechazó el token guardado
  if (!result.ok && /Invalid API key or access token/i.test(result.error ?? '')) {
    return NextResponse.json({
      ok: false,
      locations: [],
      error:
        `Shopify rechazó el acceso de la tienda "${store.name}" (${store.shop_domain}). ` +
        'Ve a Tiendas y dale "Reconectar". Si sigue igual, revisa que la app esté instalada en esa tienda ' +
        'y que el Client ID y Client Secret guardados sean de esa misma app.',
    });
  }

  return NextResponse.json(result);
}
