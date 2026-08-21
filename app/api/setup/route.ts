import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

// Evita que Next.js intente analizar/optimizar esta ruta estáticamente
// (necesario por las dependencias de BD/auth usadas aquí).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM users`;
  return NextResponse.json({ needsSetup: rows[0].c === 0 });
}

export async function POST(req: NextRequest) {
  const rows = await sql`SELECT COUNT(*)::int AS c FROM users`;
  if (rows[0].c > 0) {
    return NextResponse.json(
      { ok: false, error: 'El registro inicial ya fue completado.' },
      { status: 403 }
    );
  }

  const { username, password } = await req.json();

  if (!username || username.length < 3) {
    return NextResponse.json({ ok: false, error: 'El usuario debe tener al menos 3 caracteres.' }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  await sql`INSERT INTO users (username, password_hash) VALUES (${username}, ${passwordHash})`;

  return NextResponse.json({ ok: true });
}
