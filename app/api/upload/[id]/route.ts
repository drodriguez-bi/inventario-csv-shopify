import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!id) {
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });
  }

  const uploadRows = await sql`
    SELECT u.*, s.name AS store_name
    FROM uploads u JOIN stores s ON s.id = u.store_id
    WHERE u.id = ${id}
  `;
  const upload = uploadRows[0];
  if (!upload) {
    return NextResponse.json({ ok: false, error: 'Carga no encontrada' }, { status: 404 });
  }

  const filter = req.nextUrl.searchParams.get('filter');
  let items;
  if (filter && ['success', 'not_found', 'error'].includes(filter)) {
    const rows = await sql`
      SELECT * FROM upload_items WHERE upload_id = ${id} AND status = ${filter} ORDER BY id
    `;
    items = rows;
  } else {
    const rows = await sql`SELECT * FROM upload_items WHERE upload_id = ${id} ORDER BY id`;
    items = rows;
  }

  return NextResponse.json({ ok: true, upload, items });
}
