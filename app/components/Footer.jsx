import { REPO_URL } from '../../lib/repo.js';
import { getStarCount } from '../../lib/stars.js';

export default async function Footer() {
  const stars = await getStarCount();

  return (
    <footer className="mx-auto mt-20 max-w-2xl px-6 pb-14">
      <div className="border-t border-(--color-rule) pt-6">
        <p className="font-(family-name:--font-mono) text-xs text-(--color-muted)">
          © 2026 runs-on.dev, a project by{' '}
          <a className="text-(--color-signal) underline" href="https://advancelabs.dev">
            Advance Labs
          </a>
          .
        </p>
        <p className="mt-2 font-(family-name:--font-mono) text-xs text-(--color-muted)">
          Already have a name?{' '}
          <a className="text-(--color-signal) underline" href="/manage">
            Point it somewhere
          </a>
          .
        </p>
        <p className="mt-2 font-(family-name:--font-mono) text-xs text-(--color-muted)">
          Every name here is a file in a public repo.{' '}
          <a
            className="text-(--color-signal) underline"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ★ Star the registry
          </a>
          {/* Only render the count once it is worth showing -- "★ 3" reads as
              nobody cares, which is worse than no number at all. */}
          {typeof stars === 'number' && stars >= 25 && (
            <span> ({stars.toLocaleString('en-US')})</span>
          )}
        </p>
      </div>
    </footer>
  );
}
