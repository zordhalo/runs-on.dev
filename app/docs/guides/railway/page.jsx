import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record, Warning } from '../../components.jsx';

export const metadata = {
  title: 'Railway',
  description: 'Point name.runs-on.dev at a Railway service with a CNAME record, and the one case our schema cannot express.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/railway' },
  openGraph: { title: 'Railway — runs-on.dev' },
};

export default function RailwayGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Railway</Eyebrow>
      <DocTitle>Railway</DocTitle>
      <Lede>you.runs-on.dev serving a Railway service, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "abcd12.up.railway.app" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Railway generates a unique <C>*.up.railway.app</C> CNAME target for each custom domain in
          its dashboard, so <C>abcd12.up.railway.app</C> above is a stand-in. Copy the exact value
          Railway shows you, not this one.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>
            In the Railway dashboard: your service → Settings → Networking → Custom Domain → enter{' '}
            <C>you.runs-on.dev</C>. Railway shows you the CNAME target to use.
          </li>
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C>, setting <C>CNAME</C> to the exact value Railway gave you.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
        </ol>
      </Section>

      <Section title="What our schema cannot express">
        <Warning>
          Railway also asks for a TXT record to verify domain ownership, alongside the CNAME. Our
          schema will not accept both at once: <C>CNAME</C> cannot coexist with <C>TXT</C> at the
          same name, since a DNS name with a CNAME cannot carry any other record type. If Railway
          shows the TXT record at the same hostname as the CNAME (<C>you.runs-on.dev</C> itself),
          there is no way to add it here, so skip it and add only the CNAME above. If
          Railway&apos;s dashboard keeps the domain unverified without the TXT record, this is the
          limit of what this registry can express for Railway: contact Railway support about
          verifying without it, or host on a provider that only needs a CNAME.
        </Warning>
        <p className="text-sm leading-relaxed sm:text-base">
          If Railway instead shows the TXT record at a different hostname (a prefixed subdomain, for
          example), add it under <C>subdomains</C> at that label instead, since a subdomain entry and
          the root <C>records</C> object don&apos;t share the CNAME-exclusivity rule with each other.
        </p>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Networking → Custom Domain shows the domain as active once Railway has confirmed it.
          Visiting <C>https://you.runs-on.dev</C> should then serve the service.
        </p>
      </Section>
    </main>
  );
}
