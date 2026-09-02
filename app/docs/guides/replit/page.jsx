import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Replit',
  description: 'Point name.runs-on.dev at a Replit deployment with an A and TXT record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/replit' },
  openGraph: { title: 'Replit — runs-on.dev' },
};

export default function ReplitGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Replit</Eyebrow>
      <DocTitle>Replit</DocTitle>
      <Lede>you.runs-on.dev serving a Replit deployment, over HTTPS, via A and TXT records.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": {
  "A": ["192.0.2.1"],
  "TXT": ["replit-verify=abc123"]
}`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Replit generates both values per domain connection, so <C>192.0.2.1</C> and{' '}
          <C>replit-verify=abc123</C> above are stand-ins. Copy the exact values Replit&apos;s
          dashboard shows you. Manual DNS setup is the right path here, not the Entri
          auto-configure option, since that writes to a registrar&apos;s DNS panel directly and this
          registry has none.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>A</C> and <C>TXT</C> can coexist at the same name, which is exactly what Replit needs:
          the TXT record stays in place permanently, since Replit reuses it for certificate renewal.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>
            In Replit: your deployment → Publishing → Domains → Manual Setup → <C>you.runs-on.dev</C>.
            Note the A and TXT values it shows you.
          </li>
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above, using those values.</li>
          <li>Open a pull request. Once merged, both records are synced to DNS automatically.</li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          The Domains tab shows <C>you.runs-on.dev</C> as verified once Replit confirms both
          records. Visiting <C>https://you.runs-on.dev</C> should then serve the deployment.
        </p>
      </Section>
    </main>
  );
}
