import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Firebase Hosting',
  description: 'Point name.runs-on.dev at a Firebase Hosting site with an A record.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/firebase' },
  openGraph: { title: 'Firebase Hosting — runs-on.dev' },
};

export default function FirebaseGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Firebase Hosting</Eyebrow>
      <DocTitle>Firebase Hosting</DocTitle>
      <Lede>you.runs-on.dev serving a Firebase Hosting site, over HTTPS, via an A record.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": { "A": ["199.36.158.100"] }`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          Firebase&apos;s Quick Setup flow points a custom subdomain at this IP for every project,
          the same address it shows in the console. Firebase can change it, so if the console shows
          a different address when you set this up, use that one instead.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>
            In the Firebase console: Hosting → Add custom domain → <C>you.runs-on.dev</C> → Quick
            Setup. Note the A record value it shows you.
          </li>
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above, using that value.</li>
          <li>Open a pull request. Once merged, the A record is synced to DNS automatically.</li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          The Hosting console shows <C>you.runs-on.dev</C> as connected once Firebase has confirmed
          the A record and issued a certificate, which can take a few hours. Visiting{' '}
          <C>https://you.runs-on.dev</C> should then serve the site.
        </p>
      </Section>
    </main>
  );
}
