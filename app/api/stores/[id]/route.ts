import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!id) {
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });
  }

  // Una tienda tiene cargas (historial) y feeds que dependen de ella, así que se
  // borran primero, en este orden:
  //   1) cargas de la tienda (sus filas de detalle se borran en cascada),
  //   2) feeds de la tienda (su memoria de cantidades se borra en cascada),
  //   3) la tienda.
  await sql`DELETE FROM uploads WHERE store_id = ${id}`;
  await sql`DELETE FROM feeds WHERE store_id = ${id}`;
  await sql`DELETE FROM stores WHERE id = ${id}`;

  return NextResponse.json({ ok: true });
}
