import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // OJO: nunca se devuelve ftp_password al navegador.
  const rows = await sql`
    SELECT f.id, f.name, f.token, f.location_name, f.created_at,
           f.ftp_protocol, f.ftp_host, f.ftp_port, f.ftp_user, f.ftp_path,
           f.last_pulled_at, f.last_pull_status,
           s.id AS store_id, s.name AS store_name
    FROM feeds f
    JOIN stores s ON s.id = f.store_id
    ORDER BY f.created_at DESC
  `;
  return NextResponse.json({ ok: true, feeds: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, store_id, location_id, location_name } = body;

  if (!name?.trim() || !store_id || !location_id) {
    return NextResponse.json({ ok: false, error: 'Nombre, tienda y sucursal son obligatorios.' }, { status: 400 });
  }

  const ftpHost = String(body.ftp_host ?? '').trim();
  let ftpProtocol: string | null = null;
  let ftpPort: number | null = null;
  let ftpUser: string | null = null;
  let ftpPassword: string | null = null;
  let ftpPath: string | null = null;

  if (ftpHost) {
    ftpUser = String(body.ftp_user ?? '').trim();
    ftpPassword = String(body.ftp_password ?? '').trim();
    if (!ftpUser || !ftpPassword) {
      return NextResponse.json({ ok: false, error: 'Para leer por FTP hacen falta usuario y contraseña.' }, { status: 400 });
    }
    ftpProtocol = ['ftp', 'ftps', 'sftp'].includes(body.ftp_protocol) ? body.ftp_protocol : 'ftp';
    const p = parseInt(body.ftp_port, 10);
    ftpPort = Number.isFinite(p) && p > 0 ? p : null;
    ftpPath = String(body.ftp_path ?? '').trim() || null;
  }

  const token = crypto.randomBytes(24).toString('hex');

  const rows = await sql`
    INSERT INTO feeds (name, store_id, location_id, location_name, token,
                       ftp_protocol, ftp_host, ftp_port, ftp_user, ftp_password, ftp_path)
    VALUES (${name.trim()}, ${store_id}, ${location_id}, ${location_name ?? ''}, ${token},
            ${ftpProtocol}, ${ftpHost || null}, ${ftpPort}, ${ftpUser}, ${ftpPassword}, ${ftpPath})
    RETURNING id
  `;

  return NextResponse.json({ ok: true, feedId: rows[0].id, token });
}
