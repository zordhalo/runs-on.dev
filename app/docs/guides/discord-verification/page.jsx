import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Discord verification',
  description: 'Verify ownership of you.runs-on.dev with Discord using a _discord TXT subdomain.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/discord-verification' },
  openGraph: { title: 'Discord verification — runs-on.dev' },
};

export default function DiscordVerificationGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Discord verification</Eyebrow>
      <DocTitle>Discord verification</DocTitle>
      <Lede>Proving you own you.runs-on.dev to Discord, via a TXT record.</Lede>

      <Section title="What you'll end up with">
        <p className="text-sm leading-relaxed sm:text-base">
          Discord verifies domain ownership (for a linked-role application, or a domain attached to
          your profile) by checking for a TXT record at <C>_discord.you.runs-on.dev</C> containing a
          token it generates for you.
        </p>
      </Section>

      <Section title="The record">
        <Record path="domains/you.json">{`"subdomains": {
  "_discord": { "TXT": ["dh=0f817e9945292eb7eaba294fbba9b6f50d74a885"] }
}`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          The <C>dh=...</C> value is generated per domain by Discord, shown when you start
          verification. Replace it with your own; the one above is only an example of the shape.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>
            In Discord&apos;s domain verification flow (Developer Portal, for a linked-role
            application, or your user settings for a profile domain), enter{' '}
            <C>you.runs-on.dev</C> and copy the <C>dh=...</C> value it gives you.
          </li>
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above, using that value.</li>
          <li>Open a pull request. Once merged, the TXT record is synced to DNS automatically.</li>
          <li>Back in Discord, click Verify.</li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Discord confirms verification as soon as it can resolve the <C>_discord</C> TXT record and
          the token matches, usually within a minute of the pull request merging.
        </p>
      </Section>
    </main>
  );
}
