// Metadata for a claimed name's profile card.
//
// Split out from the page so the parts that are easy to get wrong are
// testable without rendering: every URL here has to be absolute. The root
// layout sets metadataBase to https://runs-on.dev, so a relative canonical
// would resolve to the apex and tell crawlers that every card in the
// registry is the same page.
export function cardMetadata({ name, record, profile }) {
  const url = `https://${name}.runs-on.dev`;
  const login = record.owner.github;

  // GitHub allows newlines in a bio; a meta description with them in is
  // still valid but reads badly wherever it is echoed back.
  const bio = profile?.bio?.replace(/\s+/g, ' ').trim();

  const title = profile?.name ? `${profile.name} (${name}.runs-on.dev)` : `${name}.runs-on.dev`;
  const description =
    bio || `${name}.runs-on.dev is a subdomain claimed by @${login} on the runs-on.dev registry.`;

  // The per-claim banner route, not a file-convention image: /sites/* is
  // blocked from the outside by proxy.js, so an OG URL under it would 404
  // for every crawler. /banner/<name> is public, absolute, and the same art
  // a person gets when they share the link by hand.
  const banner = `https://runs-on.dev/banner/${name}`;

  return {
    // `absolute` bypasses the layout's '%s — runs-on.dev' template, which
    // would otherwise render 'shrey.runs-on.dev — runs-on.dev'.
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'profile',
      siteName: 'runs-on.dev',
      url,
      title,
      description,
      images: [{ url: banner, width: 1200, height: 630, alt: title }],
    },
    // X reads twitter:* in preference to og:*, so these have to be set
    // explicitly. Inheriting them is what made every claimed name unfurl as
    // the registry's own homepage card.
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [banner],
    },
  };
}
