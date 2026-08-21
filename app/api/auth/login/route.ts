import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyPassword, createSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'Usuario y contraseña son requeridos.' }, { status: 400 });
  }

  const rows = await sql`SELECT id, username, password_hash FROM users WHERE username = ${username}`;
  const user = rows[0];

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ ok: false, error: 'Usuario o contraseña incorrectos.' }, { status: 401 });
  }

  await createSession({ userId: user.id, username: user.username });

  return NextResponse.json({ ok: true });
}
