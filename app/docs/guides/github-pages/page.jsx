import { Section, Quote } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'GitHub Pages',
  description: 'Point name.runs-on.dev at a GitHub Pages site with a CNAME record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/github-pages' },
  openGraph: { title: 'GitHub Pages — runs-on.dev' },
};

export default function GithubPagesGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / GitHub Pages</Eyebrow>
      <DocTitle>GitHub Pages</DocTitle>
      <Lede>you.runs-on.dev serving a GitHub Pages site, over HTTPS, via CNAME.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "CNAME": "you.github.io" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Replace <C>you</C> with your GitHub username or org, exactly as it appears in your Pages
          URL.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the CNAME is synced to DNS automatically.</li>
          <li>
            In the Pages repo itself, add a file named <C>CNAME</C> at the repo root containing a
            single line, <C>you.runs-on.dev</C>. This is GitHub&apos;s own custom-domain mechanism,
            independent of the registry, and Pages will not serve the custom domain without it.
          </li>
          <li>
            In the repo&apos;s Settings → Pages, the custom domain field should show{' '}
            <C>you.runs-on.dev</C> (GitHub reads it from the <C>CNAME</C> file once pushed). Enable
            &quot;Enforce HTTPS&quot; once the certificate is issued.
          </li>
        </ol>
        <Quote>
          Order matters less than you&apos;d think here: the registry PR and the Pages{' '}
          <C>CNAME</C> file can land in either order, GitHub just won&apos;t issue a certificate
          until both point at each other.
        </Quote>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Settings → Pages shows &quot;DNS check successful&quot; once GitHub confirms the CNAME.
          Visiting <C>https://you.runs-on.dev</C> should then serve the Pages site.
        </p>
      </Section>
    </main>
  );
}
