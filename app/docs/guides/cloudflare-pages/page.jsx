import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Cloudflare Pages',
  description: 'Point name.runs-on.dev at a Cloudflare Pages project with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/cloudflare-pages' },
  openGraph: { title: 'Cloudflare Pages — runs-on.dev' },
};

export default function CloudflarePagesGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Cloudflare Pages</Eyebrow>
      <DocTitle>Cloudflare Pages</DocTitle>
      <Lede>you.runs-on.dev serving a Cloudflare Pages project, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "you-project.pages.dev" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Replace <C>you-project</C> with your Pages project&apos;s own <C>*.pages.dev</C>{' '}
          subdomain, shown at the top of the project in the Cloudflare dashboard.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Cloudflare dashboard: your Pages project → Custom domains → Set up a custom
            domain → <C>you.runs-on.dev</C>. Cloudflare issues the certificate once it can see the
            CNAME.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Custom domains shows &quot;Active&quot; for <C>you.runs-on.dev</C> once the certificate is
          issued. Visiting <C>https://you.runs-on.dev</C> should then serve the project.
        </p>
      </Section>
    </main>
  );
}
