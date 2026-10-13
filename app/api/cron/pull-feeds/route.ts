import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { pullFeed } from '@/lib/feedPull';
import { processPendingBatch } from '@/lib/feedProcessor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Este es el endpoint que hay que "tocar" cada 5 minutos:
//   1) lee el archivo de cada feed configurado con FTP/SFTP,
//   2) encola solo los SKU que cambiaron,
//   3) procesa pendientes contra Shopify con el tiempo que sobre.
//
//   GET /api/cron/pull-feeds?token=TU_CRON_SECRET
//   (o header Authorization: Bearer TU_CRON_SECRET, como lo manda Vercel Cron)

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'Falta configurar CRON_SECRET.' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization');
  const tokenParam = req.nextUrl.searchParams.get('token');
  if (authHeader !== `Bearer ${expected}` && tokenParam !== expected) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  const startedAt = Date.now();

  const feeds = await sql`SELECT * FROM feeds WHERE ftp_host IS NOT NULL AND ftp_host <> ''`;
  const pulled: { feed: string; ok: boolean; status: string }[] = [];
  for (const feed of feeds as any[]) {
    const r = await pullFeed(feed);
    pulled.push({ feed: feed.name, ok: r.ok, status: r.status });
  }

  const budget = Math.max(5_000, 50_000 - (Date.now() - startedAt));
  const processing = await processPendingBatch(budget);

  return NextResponse.json({
    ok: true,
    feeds: pulled,
    processed: processing.processed,
    hasMore: processing.hasMore,
  });
}
