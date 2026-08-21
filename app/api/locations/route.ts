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

  const result = await getLocations({
    shop_domain: store.shop_domain,
    access_token: store.access_token,
    api_version: store.api_version,
  });

  return NextResponse.json(result);
}
