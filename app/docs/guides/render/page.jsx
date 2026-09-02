import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Render',
  description: 'Point name.runs-on.dev at a Render web service with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/render' },
  openGraph: { title: 'Render — runs-on.dev' },
};

export default function RenderGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Render</Eyebrow>
      <DocTitle>Render</DocTitle>
      <Lede>you.runs-on.dev serving a Render web service, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "you-service.onrender.com" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Replace <C>you-service</C> with your service&apos;s own <C>*.onrender.com</C> hostname,
          shown at the top of the service page in the Render dashboard.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Render dashboard: your service → Settings → Custom Domains → Add Custom Domain →{' '}
            <C>you.runs-on.dev</C>. Render verifies the CNAME and issues a certificate automatically.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Custom Domains shows the domain as verified once Render has confirmed the CNAME and issued
          a certificate. Visiting <C>https://you.runs-on.dev</C> should then serve the service.
        </p>
      </Section>
    </main>
  );
}
