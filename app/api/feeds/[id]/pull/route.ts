import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { pullFeed } from '@/lib/feedPull';
import { processPendingBatch } from '@/lib/feedProcessor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// "Leer ahora": botón de la pantalla Feeds. Requiere sesión (lo protege el middleware).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const rows = await sql`SELECT * FROM feeds WHERE id = ${id}`;
  const feed = rows[0] as any;
  if (!feed) return NextResponse.json({ ok: false, error: 'Feed no encontrado.' }, { status: 404 });
  if (!feed.ftp_host) {
    return NextResponse.json({ ok: false, error: 'Este feed no tiene un servidor FTP configurado.' }, { status: 400 });
  }

  const result = await pullFeed(feed);
  let processed = 0;
  if (result.ok) {
    processed = (await processPendingBatch(35_000)).processed;
  }
  return NextResponse.json({ ...result, processed });
}
