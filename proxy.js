import { NextResponse } from 'next/server';
import { validateName } from './lib/name.js';

const ROOT = 'runs-on.dev';

export const config = {
  matcher: ['/((?!api|_next|favicon.ico|icon.svg).*)'],
};

export function proxy(request) {
  const host = (request.headers.get('host') ?? '').split(':')[0];

  // /sites/* is a real, publicly routable path, so refuse it from the outside on
  // every host. An internal rewrite does not re-enter proxy, so cards still render.
  // Exception: localhost outside production, so the claim-404 page can be tested
  // without a wildcard-host entry in /etc/hosts. Gated on the environment, never
  // on the caller's Host header, so the invariant above holds in production
  // regardless of what a client sends.
  const isDev = process.env.NODE_ENV !== 'production';
  if (request.nextUrl.pathname.startsWith('/sites/') && !(isDev && host === 'localhost')) {
    return new NextResponse('not found', { status: 404 });
  }

  if (host === ROOT || host === `www.${ROOT}` || host.endsWith('.vercel.app') || host === 'localhost') {
    return NextResponse.next();
  }

  if (!host.endsWith(`.${ROOT}`)) return NextResponse.next();

  const name = host.slice(0, -1 * (ROOT.length + 1)).toLowerCase();
  if (name.includes('.')) return NextResponse.next();

  // Validate before rewriting. The card route spends an authenticated GitHub request
  // per render, drawn from the same quota the claim path depends on, so an unvalidated
  // Host header would let anyone burn that budget for free and push real claims into
  // the 503 path. Same rule /api/claim and /api/check already apply.
  if (!validateName(name).ok) {
    return new NextResponse('not found', { status: 404 });
  }

  // A claimed host serves exactly one thing: that name's card, at "/". Every
  // other path belongs to the registry, and the card page renders the site
  // footer and the nav dock, whose links are relative -- so clicking "manage"
  // on kl.runs-on.dev asked kl.runs-on.dev for /manage, which rewrote to
  // /sites/kl/manage, which does not exist, and 404'd. Every link on a card
  // was broken this way, and so was any path a visitor typed.
  //
  // Sending them to the apex is where they were always meant to go. 307 rather
  // than a permanent redirect: this is a routing decision we might revisit if
  // claims ever serve sub-paths of their own, and a cached 308 would outlive
  // the change in browsers we cannot reach.
  if (request.nextUrl.pathname !== '/') {
    const target = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, `https://${ROOT}`);
    return NextResponse.redirect(target, 307);
  }

  return NextResponse.rewrite(new URL(`/sites/${name}${request.nextUrl.pathname}`, request.url));
}
