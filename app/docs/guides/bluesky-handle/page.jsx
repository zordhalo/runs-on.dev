import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Bluesky handle',
  description: 'Use you.runs-on.dev as a verified Bluesky handle with an _atproto TXT subdomain.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/bluesky-handle' },
  openGraph: { title: 'Bluesky handle — runs-on.dev' },
};

export default function BlueskyHandleGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Bluesky handle</Eyebrow>
      <DocTitle>Bluesky handle</DocTitle>
      <Lede>you.runs-on.dev as your verified Bluesky handle, via DNS, no app hosting involved.</Lede>

      <Section title="What you'll end up with">
        <p className="text-sm leading-relaxed sm:text-base">
          Bluesky can verify a custom domain as your handle by checking for a TXT record at{' '}
          <C>_atproto.you.runs-on.dev</C> containing your account&apos;s DID. Once verified,{' '}
          <C>you.runs-on.dev</C> shows on your profile in place of a <C>*.bsky.social</C> handle.
        </p>
      </Section>

      <Section title="The record">
        <Record path="domains/you.json">{`"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Replace <C>did:plc:abc123</C> with your account&apos;s actual DID, found in the Bluesky
          app under Settings → Advanced → your DID.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the TXT record is synced to DNS automatically.</li>
          <li>
            In the Bluesky app: Settings → Account → Handle → I have my own domain → enter{' '}
            <C>you.runs-on.dev</C> → No DNS Panel → Verify DNS Record.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Bluesky confirms the handle change immediately once it can resolve the TXT record and the
          DID matches. Your profile then shows <C>you.runs-on.dev</C> as your handle.
        </p>
      </Section>
    </main>
  );
}
