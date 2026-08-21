import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  destroySession();
  return NextResponse.json({ ok: true });
}
