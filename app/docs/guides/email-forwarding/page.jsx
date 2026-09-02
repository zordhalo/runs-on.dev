import { Section } from '../../../components/Section.jsx';
import { ApplyNote, C, DocTitle, Eyebrow, Lede, Record } from '../../components.jsx';

export const metadata = {
  title: 'Email forwarding',
  description: 'Forward you@you.runs-on.dev to your real inbox with MX records, using ImprovMX as the worked example.',
  alternates: { canonical: 'https://runs-on.dev/docs/guides/email-forwarding' },
  openGraph: { title: 'Email forwarding — runs-on.dev' },
};

export default function EmailForwardingGuide() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Guides / Email forwarding</Eyebrow>
      <DocTitle>Email forwarding</DocTitle>
      <Lede>you@you.runs-on.dev arriving in your real inbox, via MX records and ImprovMX.</Lede>

      <Section title="The record">
        <Record path="domains/you.json">{`"records": {
  "MX": [
    { "priority": 10, "value": "mx1.improvmx.com" },
    { "priority": 20, "value": "mx2.improvmx.com" }
  ]
}`}</Record>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>mx1.improvmx.com</C> and <C>mx2.improvmx.com</C> at priorities 10 and 20 are
          ImprovMX&apos;s standard mail servers, the same for every domain. <C>MX</C> may coexist
          with <C>A</C> and <C>TXT</C> at the same name, so this is safe to add even if you also
          point <C>you.runs-on.dev</C> at a site.
        </p>
      </Section>

      <Section title="Steps">
        <ApplyNote />

        <ol className="list-decimal space-y-2 pl-6 text-sm leading-relaxed sm:text-base">
          <li>
            At <a className="text-(--color-signal) underline" href="https://improvmx.com">improvmx.com</a>,
            add <C>you.runs-on.dev</C> as a domain and set up a forwarding alias (for example,{' '}
            <C>*@you.runs-on.dev</C> → your real address).
          </li>
          <li>Fork <a className="text-(--color-signal) underline" href="https://github.com/zordhalo/runs-on.dev">the registry</a> and edit <C>domains/you.json</C> to the record above.</li>
          <li>Open a pull request. Once merged, the MX records are synced to DNS automatically.</li>
        </ol>
      </Section>

      <Section title="How to tell it worked">
        <p className="text-sm leading-relaxed sm:text-base">
          ImprovMX&apos;s dashboard shows the domain as verified once it can see both MX records.
          Send a test email to your <C>you.runs-on.dev</C> address and confirm it lands in the
          forwarded inbox, usually within a minute.
        </p>
      </Section>
    </main>
  );
}
