import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }

  const { storeId, locationId, locationName, filename, totalRows } = await req.json();

  if (!storeId || !locationId || !totalRows) {
    return NextResponse.json({ ok: false, error: 'Faltan datos requeridos' }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO uploads (user_id, store_id, location_id, location_name, filename, total_rows, status)
    VALUES (${session.userId}, ${storeId}, ${locationId}, ${locationName ?? ''}, ${filename ?? ''}, ${totalRows}, 'processing')
    RETURNING id
  `;

  return NextResponse.json({ ok: true, uploadId: rows[0].id });
}
