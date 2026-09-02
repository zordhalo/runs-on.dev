import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record, Warning } from '../../components.jsx';

export const metadata = {
  title: 'Vercel',
  description: 'Point name.runs-on.dev at a Vercel project with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/vercel' },
  openGraph: { title: 'Vercel — runs-on.dev' },
};

export default function VercelGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Vercel</Eyebrow>
      <DocTitle>Vercel</DocTitle>
      <Lede>you.runs-on.dev serving a Vercel project, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "cname.vercel-dns.com" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>cname.vercel-dns.com</C> is the target Vercel gives most projects. Some accounts get a
          project-specific one instead, of the form{' '}
          <C>&lt;hash&gt;.vercel-dns-017.com</C>. Copy whatever your own Domains tab shows rather
          than the value above, and leave off any trailing dot: <C>example.com.</C> fails the
          hostname grammar, <C>example.com</C> passes.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Vercel dashboard: your project → Settings → Domains → add{' '}
            <C>you.runs-on.dev</C>. Vercel then shows you the DNS it wants. Usually that is the
            CNAME alone. If it also shows a <C>TXT</C> record, read the next section before adding
            anything.
          </li>
        </ol>
      </Section>

      <Section title="If Vercel also asks for a verification TXT">
        <p className="text-sm leading-relaxed sm:text-base">
          Vercel sometimes asks you to prove you control the domain, and shows a <C>TXT</C> record
          whose value starts with <C>vc-domain-verify=</C>. It belongs at{' '}
          <C>_vercel.you.runs-on.dev</C>, one label below your name, which is what the{' '}
          <C>subdomains</C> key is for:
        </p>
        <Record path="domains/you.json">{`{
  "records": { "CNAME": "cname.vercel-dns.com" },
  "subdomains": {
    "_vercel": {
      "TXT": ["vc-domain-verify=you.runs-on.dev,abc123"]
    }
  }
}`}</Record>
        <Warning>
          Do not put that <C>TXT</C> beside the <C>CNAME</C> in <C>records</C>. A name carrying a{' '}
          <C>CNAME</C> cannot carry any other record type, which is a DNS rule rather than something
          this registry chose, and the record will be rejected. Under <C>subdomains</C> it is a
          different name, so the two coexist happily.
        </Warning>
        <p className="text-sm leading-relaxed sm:text-base">
          <a className="text-(--color-signal) underline" href="/manage">The record form</a> sets
          this without a pull request: add a subdomain row, label it <C>_vercel</C>, pick{' '}
          <C>TXT</C>, and paste the value.
        </p>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          The Domains tab in Vercel shows a green &quot;Valid Configuration&quot; once DNS has
          propagated and the certificate is issued, usually within a few minutes of the record
          landing. Visiting <C>https://you.runs-on.dev</C> should then serve your project. If it
          stays on &quot;Invalid Configuration&quot;, check the CNAME target character for character
          against what the Domains tab shows.
        </p>
      </Section>
    </main>
  );
}
