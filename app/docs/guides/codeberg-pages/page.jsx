import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Codeberg Pages',
  description: 'Point name.runs-on.dev at a Codeberg Pages site with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/codeberg-pages' },
  openGraph: { title: 'Codeberg Pages — runs-on.dev' },
};

export default function CodebergPagesGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Codeberg Pages</Eyebrow>
      <DocTitle>Codeberg Pages</DocTitle>
      <Lede>you.runs-on.dev serving a Codeberg Pages site, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "codeberg.page" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Codeberg&apos;s own docs write this target with a trailing dot (<C>codeberg.page.</C>),
          the zone-file convention for &quot;fully qualified, don&apos;t append anything.&quot; Our
          schema validates <C>CNAME</C> as a plain hostname and rejects the trailing dot, so leave
          it off here; the DNS record that gets created is equivalent either way.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>
            Open a pull request. Once merged, the CNAME is synced to DNS automatically. The current
            Codeberg Pages server treats the CNAME itself as authorization, so there is no separate{' '}
            <C>.domains</C> file to add to the Pages repo (that was only needed by the retired Pages
            Server v2).
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Visiting <C>https://you.runs-on.dev</C> should serve the Pages site once DNS has
          propagated and Codeberg has issued a certificate, usually within a few minutes.
        </p>
      </Section>
    </main>
  );
}
