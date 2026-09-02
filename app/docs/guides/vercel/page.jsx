import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

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
          <C>cname.vercel-dns.com</C> is the fixed target Vercel uses for every custom domain, not
          something specific to your project.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Vercel dashboard: your project → Settings → Domains → add{' '}
            <C>you.runs-on.dev</C>. Vercel shows this exact <C>cname.vercel-dns.com</C> target when
            it asks you to configure DNS, confirming there is nothing else to add.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          The Domains tab in Vercel shows a green &quot;Valid Configuration&quot; once DNS has
          propagated and the certificate is issued, usually within a few minutes of the pull request
          merging. Visiting <C>https://you.runs-on.dev</C> should then serve your project.
        </p>
      </Section>
    </main>
  );
}
