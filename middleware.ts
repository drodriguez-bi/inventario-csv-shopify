import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup',
  '/feed',             // /feed/{token} — página pública de subida, sin login
  '/api/feed',         // /api/feed/{token} — receptor externo, no requiere login
  '/api/feed-inbox',   // receptor externo alterno (auth por header), no requiere login
  '/api/cron/process-feed',
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('session')?.value;

  if (!token) {
    return redirectOrDeny(req);
  }

  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    return redirectOrDeny(req);
  }
}

function redirectOrDeny(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 });
  }
  const loginUrl = new URL('/login', req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/upload/:path*', '/history/:path*', '/stores/:path*', '/feeds/:path*', '/feed/:path*', '/api/:path*', '/'],
};
