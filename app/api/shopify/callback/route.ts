import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Si algo falla al volver de Shopify, regresamos a la pantalla Tiendas con el motivo
// (antes se veía como texto técnico en una página en blanco).
function back(req: NextRequest, error: string, log?: unknown) {
  console.error('Conexión con Shopify falló:', error, log ?? '');
  return NextResponse.redirect(`${req.nextUrl.origin}/stores?error=${encodeURIComponent(error)}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const hmac = searchParams.get('hmac');

  if (!shop || !code || !state || !hmac) {
    return back(req, 'Shopify no devolvió los datos de la autorización (faltan parámetros). Vuelve a intentar con "Conectar con Shopify".');
  }

  const rows = await sql`SELECT * FROM stores WHERE lower(shop_domain) = lower(${shop}) AND oauth_state = ${state}`;
  const store = rows[0];

  if (!store) {
    return back(
      req,
      `No hay una conexión pendiente para ${shop}. Si la autorización tardó mucho, vuelve a darle "Conectar con Shopify" desde la lista.`
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
    return back(
      req,
      'La firma de Shopify no coincide: el Client Secret guardado para esta tienda no es el de la app que se autorizó. ' +
        'Elimina la tienda y vuelve a registrarla con el Client ID y Client Secret correctos.'
    );
  }

  // Intercambiar el código temporal por un access token permanente
  let tokenData: any = null;
  let tokenOk = false;
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: store.client_id,
        client_secret: store.client_secret,
        code,
      }),
    });
    tokenOk = tokenRes.ok;
    tokenData = await tokenRes.json().catch(() => null);
  } catch (e: any) {
    return back(req, `No se pudo contactar a Shopify para obtener el token: ${e?.message || e}`);
  }

  if (!tokenOk || !tokenData?.access_token) {
    const detail = tokenData?.error_description || tokenData?.error || JSON.stringify(tokenData);
    return back(req, `Shopify no entregó el token: ${detail}`, tokenData);
  }

  await sql`
    UPDATE stores
    SET access_token = ${tokenData.access_token}, oauth_state = NULL
    WHERE id = ${store.id}
  `;

  return NextResponse.redirect(`${req.nextUrl.origin}/stores?connected=1`);
}
