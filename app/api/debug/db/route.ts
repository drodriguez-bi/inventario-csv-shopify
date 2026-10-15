import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Diagnóstico: muestra QUÉ base de datos usa el sistema y qué tiendas ve en ella.
// Requiere sesión (lo protege el middleware). No muestra tokens, secretos ni contraseñas:
// solo el servidor de la base de datos (sin usuario ni clave) y el LARGO de cada token.
function hostOf(url?: string) {
  if (!url) return null;
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^[^@]*@/, '').split(/[/?]/)[0];
}

export async function GET() {
  const usa = process.env.DATABASE_URL ? 'DATABASE_URL' : process.env.POSTGRES_URL ? 'POSTGRES_URL' : 'ninguna';

  const info = (await sql`SELECT current_database() AS base_de_datos, NOW() AS hora_del_servidor`)[0];
  const stores = await sql`
    SELECT id, name, shop_domain,
           COALESCE(LENGTH(access_token), 0) AS largo_token,
           (oauth_state IS NOT NULL)          AS conexion_pendiente,
           created_at
    FROM stores
    ORDER BY id
  `;

  return NextResponse.json({
    variable_que_usa_el_sistema: usa,
    servidor_DATABASE_URL: hostOf(process.env.DATABASE_URL),
    servidor_POSTGRES_URL: hostOf(process.env.POSTGRES_URL),
    ...info,
    tiendas_que_ve_el_sistema: stores,
  });
}
