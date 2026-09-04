import { ImageResponse } from 'next/og';
import { ClaimBanner, BANNER_SIZE, claimBannerData } from '../../../lib/claim-banner.jsx';
import { validateName } from '../../../lib/name.js';

// The shareable per-claim banner: /banner/<name>?theme=dark for the GitHub
// README look, light by default to match the site. Everything it renders is
// public record, so the response caches at the edge for five minutes — long
// enough that a popular README costs nothing per view, short enough that a
// just-saved profile change shows up promptly.
export async function GET(request, { params }) {
  const { name } = await params;
  if (!validateName(name).ok) {
    return new Response('not found', { status: 404 });
  }

  const data = await claimBannerData(name);
  if (!data) {
    return new Response('not found', { status: 404 });
  }

  const theme = new URL(request.url).searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const res = new ImageResponse(<ClaimBanner {...data} theme={theme} />, { ...BANNER_SIZE });
  res.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
  return res;
}
