import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const hmac = searchParams.get('hmac');

  if (!shop || !code || !state || !hmac) {
    return NextResponse.json({ ok: false, error: 'Faltan parámetros en la respuesta de Shopify.' }, { status: 400 });
  }

  const rows = await sql`SELECT * FROM stores WHERE shop_domain = ${shop} AND oauth_state = ${state}`;
  const store = rows[0];

  if (!store) {
    return NextResponse.json(
      { ok: false, error: 'No se encontró una conexión pendiente para esta tienda (estado inválido o expirado).' },
      { status: 400 }
    );
  }

  // Verificar que la respuesta realmente viene de Shopify, firmada con nuestro client_secret
  const message = Array.from(searchParams.entries())
    .filter(([key]) => key !== 'hmac' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const generatedHmac = crypto.createHmac('sha256', store.client_secret).update(message).digest('hex');

  const validHmac =
    generatedHmac.length === hmac.length &&
    crypto.timingSafeEqual(Buffer.from(generatedHmac), Buffer.from(hmac));

  if (!validHmac) {
    return NextResponse.json({ ok: false, error: 'Firma (HMAC) inválida. Conexión rechazada por seguridad.' }, { status: 401 });
  }

  // Intercambiar el código temporal por un access token permanente
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: store.client_id,
      client_secret: store.client_secret,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.json(
      { ok: false, error: 'Shopify no devolvió un access token.', detail: tokenData },
      { status: 502 }
    );
  }

  await sql`
    UPDATE stores
    SET access_token = ${tokenData.access_token}, oauth_state = NULL
    WHERE id = ${store.id}
  `;

  return NextResponse.redirect(`${req.nextUrl.origin}/stores?connected=1`);
}
