import { NextResponse, type NextRequest } from 'next/server';

// Quick gate: without a session cookie, app pages go straight to /login.
// The session itself is checked by the backend in the (app) layout.
export function proxy(request: NextRequest) {
  if (request.cookies.has('rb_session')) return NextResponse.next();

  const login = new URL('/login', request.url);
  const returnTo = request.nextUrl.pathname + request.nextUrl.search;
  if (returnTo !== '/') login.searchParams.set('returnTo', returnTo);
  return NextResponse.redirect(login);
}

export const config = {
  // App pages only: not /login, the backend proxies (/api, /health, /admin) or static files.
  matcher: ['/((?!login|api|health|admin|_next/static|_next/image|favicon.ico).*)'],
};
