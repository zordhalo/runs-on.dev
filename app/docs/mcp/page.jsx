import { Section } from '../../components/Section.jsx';
import { Eyebrow, DocTitle, Lede, C, Code, Warning } from '../components.jsx';

export const metadata = {
  title: 'MCP server',
  description:
    'Connect Claude Code, Codex, or any MCP client to runs-on.dev and let your agent edit DNS, deploy a static site, and roll it back on your claimed name.',
  alternates: { canonical: 'https://runs-on.dev/docs/mcp' },
  openGraph: { title: 'MCP server · runs-on.dev' },
};

const TOOLS = [
  ['check_name', 'none', 'Is a name available to claim?'],
  ['get_record', 'none', "Any claimed name's public record."],
  ['whoami', 'any token', 'Your login, the token scope, and the names you own.'],
  ['update_records', 'manage', 'Replace the apex records, subdomains, or profile card.'],
  ['deploy_site', 'any token', 'Publish static files to https://<name>.runs-on.dev/.'],
  ['list_deployments', 'any token', 'Deployment history and which one is live.'],
  ['rollback_site', 'any token', 'Re-point the live site at an earlier deployment.'],
];

export default function Mcp() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Eyebrow>Docs / MCP</Eyebrow>
      <DocTitle>Manage your name from an agent</DocTitle>
      <Lede>
        runs-on.dev runs a Model Context Protocol server at <C>https://runs-on.dev/.well-known/mcp</C>.
        Connect Claude Code, Codex, Cursor, or any MCP client, and your agent can point your DNS,
        publish a site, and roll it back, all on the name you own.
      </Lede>

      <Section title="1. Mint a token">
        <p className="text-sm leading-relaxed sm:text-base">
          Sign in at <a className="text-(--color-ink) underline" href="/manage">runs-on.dev/manage</a>,
          pick a lifetime, and generate a token. Tick <C>also edit DNS (manage)</C> if the agent
          should be able to change records. Leave it off for a deploy-only key. The token is shown
          once, so copy it right away.
        </p>
        <Warning>
          A manage token can repoint your name anywhere. Give it the shortest lifetime that works,
          keep it out of git, and delete it from /manage when you are done. Deleting takes effect
          immediately.
        </Warning>
      </Section>

      <Section title="2. Connect your agent">
        <p className="text-sm leading-relaxed sm:text-base">Claude Code:</p>
        <Code>{`claude mcp add --transport http runs-on \\
  https://runs-on.dev/.well-known/mcp \\
  --header "Authorization: Bearer rod1.YOUR_TOKEN"`}</Code>
        <p className="text-sm leading-relaxed sm:text-base">
          Codex reads the token from an environment variable, so it never lands in a config file:
        </p>
        <Code>{`export RUNS_ON_TOKEN=rod1.YOUR_TOKEN
codex mcp add runs-on --url https://runs-on.dev/.well-known/mcp \\
  --bearer-token-env-var RUNS_ON_TOKEN`}</Code>
        <p className="text-sm leading-relaxed sm:text-base">
          Any other client: a Streamable HTTP server at the URL above, with an{' '}
          <C>Authorization: Bearer</C> header. Without a token you still get the two public tools.
        </p>
      </Section>

      <Section title="3. Ask for what you want">
        <p className="text-sm leading-relaxed sm:text-base">Plain requests work. For example:</p>
        <Code>{`Point my runs-on.dev name at my GitHub Pages site, zord.github.io.

Add a _discord TXT record with the value Discord gave me: dh=abc123.

Build this project and deploy dist/ to my runs-on.dev name.

The last deploy broke the homepage. Roll back to the one before it.`}</Code>
        <p className="text-sm leading-relaxed sm:text-base">
          The agent calls <C>whoami</C> and <C>get_record</C> to see where things stand, then sends
          only the fields it is changing. Every edit goes through the same validation as the /manage
          editor and pull-request CI. It lands as a public commit in the registry, and DNS follows
          within minutes.
        </p>
      </Section>

      <Section title="Tools">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-(--color-muted)">
              <tr><th className="py-2 pr-4 font-normal">tool</th><th className="py-2 pr-4 font-normal">token</th><th className="py-2 font-normal">does</th></tr>
            </thead>
            <tbody>
              {TOOLS.map(([name, token, does]) => (
                <tr key={name} className="border-t border-(--color-rule)">
                  <td className="py-2 pr-4"><C>{name}</C></td>
                  <td className="py-2 pr-4 text-(--color-muted)">{token}</td>
                  <td className="py-2">{does}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm leading-relaxed sm:text-base">
          <C>update_records</C> takes the same shapes as the{' '}
          <a className="text-(--color-ink) underline" href="/docs/records">record reference</a>.
          The apex is <C>{'{ "CNAME": "host" }'}</C> alone, <C>{'{ "URL": "https://…" }'}</C> alone,
          or any mix of <C>A</C>, <C>TXT</C>, and <C>MX</C>. An empty <C>{'{}'}</C> puts the name
          back on its profile card. <C>deploy_site</C> takes a list of{' '}
          <C>{'{ path, content, encoding }'}</C> files with <C>index.html</C> at the root, which suits
          small sites. For anything over a few MB, use the zip upload at <C>POST /api/sites/deploy</C>.
        </p>
      </Section>

      <Section title="What it cannot do">
        <p className="text-sm leading-relaxed sm:text-base">
          It cannot claim, swap, or release a name. Those stay in the browser behind your GitHub
          sign-in, because a token in an agent is the wrong place for an action you cannot undo. It
          also cannot touch a name you do not own: every tool checks ownership on the server, and
          writes share the same per-account rate limits as the website.
        </p>
      </Section>
    </main>
  );
}
