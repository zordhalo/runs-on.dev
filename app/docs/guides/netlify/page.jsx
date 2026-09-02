import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Netlify',
  description: 'Point name.runs-on.dev at a Netlify site with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/netlify' },
  openGraph: { title: 'Netlify — runs-on.dev' },
};

export default function NetlifyGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Netlify</Eyebrow>
      <DocTitle>Netlify</DocTitle>
      <Lede>you.runs-on.dev serving a Netlify site, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "apex-loadbalancer.netlify.com" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>apex-loadbalancer.netlify.com</C> is Netlify&apos;s standard target for a custom
          subdomain, the same for every site.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Netlify dashboard: your site → Domain management → Add a domain →{' '}
            <C>you.runs-on.dev</C>. Netlify needs the domain added here to issue a certificate for
            it, even though the DNS record itself lives in the registry, not in Netlify DNS.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Domain management shows the certificate status for <C>you.runs-on.dev</C>. Once it reads
          issued, <C>https://you.runs-on.dev</C> should serve your site.
        </p>
      </Section>
    </main>
  );
}
