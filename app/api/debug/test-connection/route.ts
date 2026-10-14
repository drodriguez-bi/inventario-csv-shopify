import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ruta temporal SOLO para diagnóstico. Muestra la respuesta cruda de Shopify
// (status + cuerpo completo) para una consulta mínima que no requiere ningún
// scope especial, para aislar si el problema es el token o algo más.
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

  const url = `https://${store.shop_domain}/admin/api/${store.api_version}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': store.access_token ?? '',
    },
    body: JSON.stringify({ query: '{ shop { name myshopifyDomain plan { displayName } } }' }),
    cache: 'no-store',
  });

  const rawText = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // no era JSON válido, dejamos parsed en null
  }

  return NextResponse.json({
    debug: true,
    request: {
      url,
      shop_domain: store.shop_domain,
      api_version: store.api_version,
      access_token_length: store.access_token?.length ?? 0,
      access_token_prefix: store.access_token ? store.access_token.slice(0, 8) : null,
    },
    response: {
      http_status: res.status,
      http_ok: res.ok,
      headers: Object.fromEntries(res.headers.entries()),
      raw_body: rawText,
      parsed_body: parsed,
    },
  });
}
