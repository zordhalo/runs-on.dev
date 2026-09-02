import { Section, Quote } from '../../components/Section.jsx';
import { Eyebrow, DocTitle, Lede, C, Code, Record } from '../components.jsx';

export const metadata = {
  title: 'Record reference',
  description: 'The complete runs-on.dev record format: every field, every supported record type, the coexistence rules, and why they exist.',
  alternates: { canonical: 'https://runs-on.dev/docs/records' },
  openGraph: { title: 'Record reference — runs-on.dev' },
};

function Row({ cells }) {
  return (
    <tr className="border-t border-(--color-rule)">
      {cells.map((cell, i) => (
        <td key={i} className="py-2 pr-4 align-top text-sm leading-relaxed">
          {cell}
        </td>
      ))}
    </tr>
  );
}

export default function Records() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / Records</Eyebrow>
      <DocTitle>Record reference</DocTitle>
      <Lede>
        Every claimed name is one JSON file at <C>domains/&lt;name&gt;.json</C>, validated by{' '}
        <C>lib/schema.js</C>&apos;s <C>validateRecord</C>. No key outside this shape is allowed.
      </Lede>

      <Section title="Shape">
        <Code>{`{
  "name": "you",
  "owner": { "github": "you" },
  "claimedAt": "2026-01-01T00:00:00.000Z",
  "records": {}
}`}</Code>
      </Section>

      <Section title="Top-level fields">
        <div>
          <p className="text-sm leading-relaxed sm:text-base">
            <strong className="text-(--color-ink)">name</strong> — the subdomain, lowercase. 2 to 32
            characters, <C>[a-z0-9]</C> with internal hyphens only (never leading or trailing), and no
            punycode (an <C>xn--</C> prefix, or <C>--</C> as the third and fourth character, is
            rejected). Must match the filename: <C>domains/you.json</C> must contain{' '}
            <C>&quot;name&quot;: &quot;you&quot;</C>.
          </p>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            <strong className="text-(--color-ink)">owner</strong> — exactly one key,{' '}
            <C>github</C>, the GitHub login that owns the record. Set once at claim time and immutable
            afterward; any change to it is rejected, from the site and by pull request alike.
          </p>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            <strong className="text-(--color-ink)">claimedAt</strong> — an ISO 8601 timestamp, set
            once at claim time. Also immutable.
          </p>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            <strong className="text-(--color-ink)">records</strong> — an object holding zero or more
            record types, detailed below. An empty <C>records</C> object is valid: it&apos;s the
            default right after claiming, and it means the name serves the built-in profile card.
          </p>
          <p className="mt-3 text-sm leading-relaxed sm:text-base">
            <strong className="text-(--color-ink)">subdomains</strong> — optional, detailed in{' '}
            <a className="text-(--color-signal) underline" href="#subdomains">its own section</a> below.
          </p>
        </div>
      </Section>

      <Section title="Record types">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="pb-2 pr-4 font-(family-name:--font-mono) text-xs tracking-[0.1em] text-(--color-muted) uppercase">Type</th>
                <th className="pb-2 pr-4 font-(family-name:--font-mono) text-xs tracking-[0.1em] text-(--color-muted) uppercase">Shape</th>
                <th className="pb-2 font-(family-name:--font-mono) text-xs tracking-[0.1em] text-(--color-muted) uppercase">Coexistence</th>
              </tr>
            </thead>
            <tbody>
              <Row cells={[<C key="t">CNAME</C>, 'A single hostname string.', 'Cannot appear with A, TXT, MX, or URL.']} />
              <Row cells={[<C key="t">A</C>, 'A non-empty array of IPv4 addresses.', 'May coexist with TXT and MX. Not with CNAME or URL.']} />
              <Row cells={[<C key="t">TXT</C>, 'A non-empty array of strings, each up to 255 characters.', 'May coexist with A and MX. Not with CNAME or URL.']} />
              <Row cells={[<C key="t">MX</C>, <>1 to 5 entries: <C key="mx">{'{ priority: 0-65535, value: hostname }'}</C></>, 'May coexist with A and TXT. Not with CNAME or URL.']} />
              <Row cells={[<C key="t">URL</C>, 'A single absolute http:// or https:// string.', 'Must be the only key in records. No DNS record is created; see below.']} />
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-relaxed sm:text-base">
          These rules come straight from <C>lib/schema.js</C>. If anything on this page ever
          disagrees with that file, the file is correct.
        </p>
      </Section>

      <Section title="Why CNAME and URL are exclusive">
        <p className="text-sm leading-relaxed sm:text-base">
          CNAME&apos;s exclusivity isn&apos;t a rule this registry invented, it&apos;s a DNS protocol
          constraint. A CNAME aliases a name to another name entirely, and DNS doesn&apos;t allow a
          name with a CNAME to carry any other record type, since that would leave a resolver with
          two contradictory answers for what the name is.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          If you need both a routing target and a verification string at the same name, use{' '}
          <C>A</C> with your host&apos;s IP addresses instead of <C>CNAME</C>, since <C>A</C> and{' '}
          <C>TXT</C> may coexist.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>URL</C> is exclusive for a different reason: it has no DNS representation at all. It is
          served by the app itself (<C>app/sites/[name]/page.jsx</C> issues a redirect), not by DNS,
          so mixing it with a DNS record type doesn&apos;t mean anything.
        </p>
      </Section>

      <Section title="URL redirects">
        <p className="text-sm leading-relaxed sm:text-base">
          A <C>URL</C> record has no DNS representation. The wildcard <C>*.runs-on.dev</C> record
          already routes every claimed name to the app, so when a record&apos;s <C>records</C> object
          holds only <C>URL</C>, the site issues a 307 redirect to that URL instead of rendering the
          profile card. <C>lib/dns.js</C>&apos;s <C>planDnsChanges</C> plans no DNS change for it.
        </p>
        <p className="text-sm leading-relaxed sm:text-base">
          Because this makes a <C>runs-on.dev</C> name an open redirector for whatever URL is in the
          file, the target must be an absolute <C>http://</C> or <C>https://</C> URL. <C>javascript:</C>,{' '}
          <C>data:</C>, <C>vbscript:</C>, and protocol-relative (<C>//evil.com</C>) values are all
          rejected, checked both in CI and again at render time.
        </p>
      </Section>

      <Section title="subdomains">
        <p id="subdomains" className="text-sm leading-relaxed sm:text-base">
          An optional object, keyed by label, letting an owner set records at a subdomain of their
          claimed name, for example <C>_atproto.you</C> for a Bluesky handle or <C>_discord.you</C>{' '}
          for Discord verification.
        </p>
        <Record path="domains/you.json">{`"subdomains": {
  "_atproto": { "TXT": ["did=did:plc:abc123"] }
}`}</Record>
        <ul className="list-disc space-y-1.5 pl-6 text-sm leading-relaxed sm:text-base">
          <li>At most 10 entries.</li>
          <li>
            Each label matches the same grammar as <C>name</C>, plus one optional leading
            underscore, and no dots: a subdomain is exactly one label deep.
          </li>
          <li>
            Each value holds <C>A</C>, <C>TXT</C>, <C>CNAME</C>, or <C>MX</C> under the same
            coexistence rules as the root <C>records</C> object. <C>URL</C> is not allowed on a
            subdomain, since the app only ever looks up the claimed name itself and could never
            serve a redirect record living underneath it.
          </li>
          <li>
            The resulting full name (<C>&lt;label&gt;.&lt;name&gt;.runs-on.dev</C>) must stay within
            the 253-character DNS name limit.
          </li>
        </ul>
      </Section>

      <Section title="How a record reaches DNS">
        <p className="text-sm leading-relaxed sm:text-base">
          Any commit that changes <C>domains/&lt;name&gt;.json</C> on <C>main</C> triggers a workflow
          that runs <C>scripts/sync-dns.mjs</C>. It computes the desired DNS records from your file
          via <C>planDnsChanges</C>, deletes whatever was synced for that name before, and creates
          the new set through Vercel&apos;s domains API. Removing your record instead of editing it
          clears any DNS it had created, the same way.
        </p>
        <Quote>
          You never touch DNS directly, and claiming itself needs no DNS write at all, since{' '}
          <C>*.runs-on.dev</C> is a wildcard record that already resolves every name.
        </Quote>
      </Section>
    </main>
  );
}
