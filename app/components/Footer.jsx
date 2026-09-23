import { REPO_URL } from '../../lib/repo.js';
import { getStarCount } from '../../lib/stars.js';

const LINKS = [
  { href: '/blog', label: 'Blog' },
  { href: '/docs', label: 'Docs' },
  { href: '/stats', label: 'Stats' },
  { href: '/faq', label: 'FAQ' },
  { href: '/policy', label: 'Policy' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/manage', label: 'Manage' },
  { href: '/feed.xml', label: 'RSS' },
];

export default async function Footer() {
  const stars = await getStarCount();

  return (
    <footer className="slit-top mt-32">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[14px] text-(--color-ink)">
              runs-on.dev, a free subdomain registry by{' '}
              <a className="text-(--color-ink) underline" href="https://advancelabs.dev/lab/runs-on">
                Advance Labs
              </a>
            </p>
            <p className="mt-2 text-[14px] text-(--color-ink)">
              <a className="text-(--color-ink) underline" href="mailto:abuse@runs-on.dev">
                abuse@runs-on.dev
              </a>
              <span className="text-(--color-muted)"> for reports</span>
            </p>
            <p className="meta mt-4 normal-case">
              © 2026 · every name is a file in a{' '}
              <a
                className="text-(--color-muted) underline hover:text-(--color-ink)"
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                public repo
              </a>
              {/* Only render the count once it is worth showing -- "★ 3" reads as
                  nobody cares, which is worse than no number at all. */}
              {typeof stars === 'number' && stars >= 25 && (
                <span> ({stars.toLocaleString('en-US')} ★)</span>
              )}
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2.5">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-(family-name:--font-mono) text-[13px] text-(--color-muted) no-underline transition-colors hover:text-(--color-ink)"
              >
                {link.label}
              </a>
            ))}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-(family-name:--font-mono) text-[13px] text-(--color-muted) no-underline transition-colors hover:text-(--color-ink)"
            >
              GitHub ↗
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
