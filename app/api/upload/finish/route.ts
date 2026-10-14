import { NextRequest, NextResponse } from 'next/server';
import { refreshUploadCounts } from '@/lib/feedProcessor';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { uploadId } = await req.json();

  if (!uploadId) {
    return NextResponse.json({ ok: false, error: 'uploadId requerido' }, { status: 400 });
  }

  // Recalcula los contadores a partir de las filas reales y marca la carga como completada.
  await refreshUploadCounts(Number(uploadId));

  return NextResponse.json({ ok: true });
}
