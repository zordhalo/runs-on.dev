import { cookies } from 'next/headers';
import { readSession } from '../../lib/session.js';
import { getOwnerIndex } from '../../lib/owners.js';
import { getRecord } from '../../lib/registry.js';
import RecordForm from './record-form.jsx';

export const metadata = {
  title: 'Manage your name — runs-on.dev',
  description: 'Point your runs-on.dev name at your own hosting.',
  robots: { index: false },
};

// Always reflects what is actually committed right now: an owner who just
// saved must not be shown a cached copy of the record they replaced.
export const dynamic = 'force-dynamic';

const TOKEN = () => process.env.REGISTRY_TOKEN;

export default async function Manage() {
  const raw = (await cookies()).get('session')?.value;
  const session = raw ? readSession(raw, process.env.SESSION_SECRET) : null;

  if (!session?.login) {
    return (
      <Shell>
        <p className="text-sm">
          <a className="text-(--color-signal) underline" href="/api/auth/github">
            Sign in with GitHub
          </a>{' '}
          to edit the record for a name you own.
        </p>
      </Shell>
    );
  }

  const index = await getOwnerIndex(session.login, { token: TOKEN() }).catch(() => null);
  const names = index?.names ?? [];

  if (names.length === 0) {
    return (
      <Shell>
        <p className="text-sm">
          @{session.login} does not own a name yet.{' '}
          <a className="text-(--color-signal) underline" href="/">
            Claim one
          </a>
          .
        </p>
      </Shell>
    );
  }

  const records = await Promise.all(
    names.map((name) => getRecord(name, { token: TOKEN() }).catch(() => null)),
  );

  return (
    <Shell>
      {records.map((record, i) =>
        record ? (
          <RecordForm key={names[i]} name={names[i]} record={record} />
        ) : (
          <p key={names[i]} className="text-sm text-(--color-muted)">
            Could not read domains/{names[i]}.json just now. Reload to try again.
          </p>
        ),
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="font-(family-name:--font-mono) text-xs tracking-[0.14em] text-(--color-muted) uppercase">
        Manage
      </p>
      <h1 className="mt-2 font-(family-name:--font-display) text-2xl font-medium tracking-tight text-(--color-ink) sm:text-3xl">
        Your name
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-(--color-muted)">
        Changes save straight to the registry. DNS updates within seconds.
      </p>
      <div className="mt-8 space-y-6">{children}</div>
    </main>
  );
}
