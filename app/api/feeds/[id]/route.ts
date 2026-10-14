import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  if (!id) {
    return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 });
  }
  // Las cargas del historial se conservan; solo se desvinculan del feed.
  await sql`UPDATE uploads SET feed_id = NULL WHERE feed_id = ${id}`;
  await sql`DELETE FROM feeds WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
