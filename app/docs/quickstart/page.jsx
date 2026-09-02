import { Section, Quote } from '../../components/Section.jsx';
import { Eyebrow, DocTitle, Lede, C, Record } from '../components.jsx';

export const metadata = {
  title: 'Quickstart',
  description: 'Claim a name.runs-on.dev and get it live end to end: sign in, claim, and the fastest way to point it somewhere.',
  alternates: { canonical: 'https://runs-on.dev/docs/quickstart' },
  openGraph: { title: 'Quickstart — runs-on.dev' },
};

export default function Quickstart() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Quickstart</Eyebrow>
      <DocTitle>Claim a name and get it working</DocTitle>
      <Lede>Start to finish, no other page required.</Lede>

      <Section title="1. Sign in">
        <p className="text-sm leading-relaxed sm:text-base">
          Go to <a className="text-(--color-signal) underline" href="https://runs-on.dev">runs-on.dev</a> and click
          <C> Sign in with GitHub</C>. This starts an OAuth flow and sets a signed session cookie, nothing more.
        </p>
      </Section>

      <Section title="2. Pick a name">
        <p className="text-sm leading-relaxed sm:text-base">
          Type a name into the field on the home page. Availability is checked as you type. A name is
          2 to 32 characters, lowercase letters, numbers, and internal hyphens only, never a leading
          or trailing hyphen.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          Claiming also requires your GitHub account to be at least 30 days old with at least one
          public repository, and one name per account. Both are checked at claim time, not just in
          the form.
        </p>
      </Section>

      <Section title="3. Claim it">
        <p className="text-sm leading-relaxed sm:text-base">
          Click <C>Claim it</C>. This writes <C>domains/&lt;name&gt;.json</C> straight to the public
          registry, no pull request needed for the claim itself. The write only succeeds if the file
          does not already exist, so two people racing for the same name never both win.
        </p>
        <Record path="domains/you.json">{`{
  "name": "you",
  "owner": { "github": "you" },
  "claimedAt": "2026-01-01T00:00:00.000Z",
  "records": {}
}`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>you.runs-on.dev</C> resolves immediately after this, over HTTPS, serving a profile card
          built from your GitHub account. There is nothing left to provision, since a wildcard DNS
          record already points every name at the app.
        </p>
      </Section>

      <Section title="4. Point it somewhere">
        <p className="text-sm leading-relaxed sm:text-base">
          The profile card is fine to leave as is. To send the name somewhere else, sign in and open{' '}
          <a className="text-(--color-signal) underline" href="/manage">runs-on.dev/manage</a>, pick a
          record type, fill it in, and save. That commits to <C>domains/&lt;name&gt;.json</C> the same
          way a merged pull request would, and DNS follows within seconds.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          The shortest thing to point at needs no hosting at all: a <C>URL</C> record, which the app
          itself redirects, with no DNS to wait on.
        </p>
        <Record path="domains/you.json">{`"records": { "URL": "https://github.com/you" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          The form only offers record types in the combinations DNS permits, so it cannot build a
          record the schema would reject. You can still do all of this by pull request instead, and
          for a <C>subdomains</C> entry you have to: fork the registry, edit the file, open a pull
          request, and CI validates the same rules the form does.
        </p>
        <Quote>
          Want it pointed at your own site instead? Same idea, a different record. See{' '}
          <a className="text-(--color-signal) underline" href="/docs/guides">the guides</a> for your host, or{' '}
          <a className="text-(--color-signal) underline" href="/docs/records">the full record reference</a>{' '}
          for every field and rule.
        </Quote>
      </Section>
    </main>
  );
}
