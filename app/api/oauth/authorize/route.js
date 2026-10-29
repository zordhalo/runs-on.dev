import { sessionFromRequest } from '../../../../lib/session.js';
import { sameLogin } from '../../../../lib/edit.js';
import { MANAGE_TOKEN_SCOPE, SITE_TOKEN_SCOPE } from '../../../../lib/tokens.js';
import {
  checkAuthorizeRequest, clientRedirect, issueCode, sealBlob, openBlob,
  issuerFor, CONSENT_TTL_MS, NO_STORE,
} from '../../../../lib/oauth.js';

// The authorization endpoint. GET validates the client's request and shows
// the consent page (after a GitHub sign-in if there is no session yet); the
// page's form POSTs back here, and only that POST issues a code.
//
// CSRF: the POST needs the session cookie, which is SameSite=Lax and so is
// never sent on a cross-site form post, AND a signed consent blob naming the
// same login, which only this page can produce. Clickjacking: the page
// refuses to be framed.

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  ...NO_STORE,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(title, inner, status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · runs-on.dev</title>
<style>body{background:#101010;color:#f3f3f3;font-family:ui-monospace,Consolas,monospace;max-width:520px;margin:60px auto;padding:0 16px;line-height:1.6}
h1{font-weight:400;font-size:22px}p,li,label{font-size:14px;color:#cfcfcf}code,b{color:#f3f3f3}.host{color:#98ff38}
hr{border:0;border-top:1px solid #2a2a2a;margin:20px 0}label{display:block;margin:8px 0;cursor:pointer}
button{font:inherit;font-size:14px;padding:8px 18px;border-radius:999px;border:1px solid #3a3a3a;background:#1a1a1a;color:#f3f3f3;cursor:pointer;margin-right:8px}
button.go{background:#f3f3f3;color:#101010;border-color:#f3f3f3}.warn{color:#ffb547}</style></head>
<body>${inner}</body></html>`, { status, headers: PAGE_HEADERS });
}

function errorPage(error) {
  const why = {
    invalid_client: 'This app is not registered with runs-on.dev, or its registration was altered.',
    invalid_redirect_uri: 'This app asked to send you back to an address it did not register.',
    not_configured: 'Sign-in for apps is not configured on this deployment.',
    expired: 'This approval page expired. Start the login from your app again.',
  }[error] ?? 'The request could not be understood.';
  return page('Cannot authorize', `<h1>Cannot authorize this app</h1><p>${esc(why)}</p><p><code>${esc(error)}</code></p>`, 400);
}

export async function GET(request) {
  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret) return errorPage('not_configured');

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);
  const checked = checkAuthorizeRequest(params, secret);
  const issuer = issuerFor(request);
  if (!checked.ok) {
    if (!checked.redirect) return errorPage(checked.error);
    return Response.redirect(clientRedirect(checked.redirectUri, {
      error: checked.error, error_description: checked.description, state: checked.state,
    }, issuer), 302);
  }

  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  if (!session?.login) {
    const back = `${url.pathname}${url.search}`;
    return Response.redirect(`${url.origin}/api/auth/github?next=${encodeURIComponent(back)}`, 302);
  }

  const { client, request: req } = checked;
  const consent = sealBlob('consent', { ...req, login: session.login, exp: Date.now() + CONSENT_TTL_MS }, secret);
  const host = new URL(req.redirectUri).host;
  const wantsManage = req.scope === MANAGE_TOKEN_SCOPE;

  return page('Authorize app', `
<h1>Connect <b>${esc(client.name)}</b> to runs-on.dev?</h1>
<p>Signed in as <b>@${esc(session.login)}</b>. After you approve, you go back to <span class="host">${esc(host)}</span>.
The app name above is what the app calls itself. If you did not just start a login from your agent, deny.</p>
<hr>
<form method="post" action="/api/oauth/authorize">
<input type="hidden" name="consent" value="${esc(consent)}">
<p>It will be able to, on names you own:</p>
<label><input type="radio" name="scope" value="${SITE_TOKEN_SCOPE}"${wantsManage ? '' : ' checked'}> deploy, list, and roll back your static site</label>
<label><input type="radio" name="scope" value="${MANAGE_TOKEN_SCOPE}"${wantsManage ? ' checked' : ''}> all of that, <b>and edit your DNS records and profile</b></label>
<p class="warn">It cannot claim, swap, or release a name. Access lasts 30 days, and you can revoke it any time under Deploy &amp; agent token on <a href="/manage" style="color:inherit">/manage</a>.</p>
<hr>
<button class="go" type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form>`);
}

export async function POST(request) {
  const secret = process.env.SITE_TOKEN_SECRET;
  if (!secret) return errorPage('not_configured');

  const session = sessionFromRequest(request, process.env.SESSION_SECRET);
  const form = await request.formData().catch(() => null);
  const req = form ? openBlob('consent', form.get('consent'), secret) : null;
  // A missing session, a forged or expired blob, or a blob minted for another
  // login all end the same way: nothing issued, start over from the app.
  if (!session?.login || !req || !sameLogin(req.login, session.login)) return errorPage('expired');

  const issuer = issuerFor(request);
  if (form.get('decision') !== 'approve') {
    return Response.redirect(clientRedirect(req.redirectUri, {
      error: 'access_denied', error_description: 'the user denied access', state: req.state,
    }, issuer), 303);
  }

  // The person may narrow or widen what the app asked for; the radio is the
  // decision. Anything but the exact opt-in word is deploy-only.
  const scope = form.get('scope') === MANAGE_TOKEN_SCOPE ? MANAGE_TOKEN_SCOPE : SITE_TOKEN_SCOPE;
  const code = issueCode({ request: req, login: session.login, scope }, secret);
  return Response.redirect(clientRedirect(req.redirectUri, { code, state: req.state }, issuer), 303);
}
