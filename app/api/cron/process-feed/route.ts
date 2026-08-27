import { NextRequest, NextResponse } from 'next/server';
import { processPendingBatch } from '@/lib/feedProcessor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Cuántas filas procesa como máximo en una sola ejecución, para no
// pasarnos del tiempo máximo permitido por la función serverless.
const BATCH_SIZE = 40;

export async function GET(req: NextRequest) {
  // Vercel Cron agrega automáticamente este header cuando la variable de
  // entorno CRON_SECRET está configurada. También aceptamos un token manual
  // por query param, por si quieres disparar esto con un cron externo
  // (ej. cron-job.org) en vez del cron nativo de Vercel.
  const authHeader = req.headers.get('authorization');
  const tokenParam = req.nextUrl.searchParams.get('token');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json({ ok: false, error: 'Falta configurar CRON_SECRET.' }, { status: 500 });
  }

  const authorized = authHeader === `Bearer ${expected}` || tokenParam === expected;
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'No autorizado.' }, { status: 401 });
  }

  const result = await processPendingBatch(BATCH_SIZE);

  return NextResponse.json({
    ok: true,
    processed: result.processed,
    hasMore: result.hasMore,
    message: result.hasMore
      ? 'Quedan más filas pendientes, la siguiente corrida las tomará.'
      : 'No hay más filas pendientes por ahora.',
  });
}
