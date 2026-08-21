import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { uploadId } = await req.json();

  if (!uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId requerido' }, { status: 400 });
  }

  await sql`
    UPDATE uploads
    SET status = 'completed', finished_at = NOW()
    WHERE id = ${uploadId}
  `;

  return NextResponse.json({ ok: true });
}
