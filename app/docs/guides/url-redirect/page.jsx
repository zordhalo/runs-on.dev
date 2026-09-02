import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'URL redirect',
  description: 'Point name.runs-on.dev at any link with a URL record, no hosting required.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/url-redirect' },
  openGraph: { title: 'URL redirect — runs-on.dev' },
};

export default function UrlRedirectGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / URL redirect</Eyebrow>
      <DocTitle>URL redirect</DocTitle>
      <Lede>A short link at your own name. No hosting, no DNS, nothing to deploy.</Lede>

      <Section title="What you'll end up with">
        <p className="text-sm leading-relaxed sm:text-base">
          Visiting <C>you.runs-on.dev</C> sends the browser to any absolute <C>http://</C> or{' '}
          <C>https://</C> URL you choose, a project page, a GitHub profile, a link-in-bio, anything.
          The redirect is served by the app itself, not DNS.
        </p>
      </Section>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "URL": "https://github.com/you" }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>URL</C> must be the only key under <C>records</C>. It cannot sit next to a{' '}
          <C>CNAME</C>, <C>A</C>, <C>TXT</C>, or <C>MX</C> record, and it is not allowed inside{' '}
          <C>subdomains</C> at all, since the app only ever looks up the claimed name itself.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a>.</li>
          <li>
            Edit <C>domains/you.json</C>, setting <C>records</C> to the block above with your own
            target URL.
          </li>
          <li>Open a pull request against <C>main</C>.</li>
          <li>
            CI validates the URL is absolute and uses <C>http:</C> or <C>https:</C>{' '}
            (<C>javascript:</C>, <C>data:</C>, and protocol-relative URLs are rejected). Once green
            and merged, the redirect takes effect within the page&apos;s 30-second cache window.
          </li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          Visit <C>https://you.runs-on.dev</C>. It should redirect (HTTP 307) to your target URL
          within a few seconds of the pull request merging.
        </p>
      </Section>
    </main>
  );
}
