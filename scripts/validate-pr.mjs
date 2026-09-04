import { validateChangeset, parseRecordFile, RecordParseError } from '../lib/pr.js';

const REPO = process.env.GITHUB_REPOSITORY;
const PR = process.env.PR_NUMBER;
const TOKEN = process.env.GITHUB_TOKEN;
const BASE_SHA = process.env.BASE_SHA;
const HEAD_SHA = process.env.HEAD_SHA;

const REQUIRED = { GITHUB_REPOSITORY: REPO, PR_NUMBER: PR, GITHUB_TOKEN: TOKEN, BASE_SHA, HEAD_SHA };
const missing = Object.entries(REQUIRED)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length > 0) {
  console.error(`validate-pr: missing required environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

const api = (path) =>
  fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

async function readAt(path, ref) {
  const res = await api(`/repos/${REPO}/contents/${path}?ref=${ref}`);
  if (!res.ok) return null;
  const body = await res.json();
  return parseRecordFile(path, Buffer.from(body.content, 'base64').toString('utf8'));
}

// Eligibility is read from the PR author's public GitHub profile, the same two
// fields the session carries into evaluateClaim on the website. Throwing rather
// than returning null on a transport failure matters: validateChangeset treats a
// throw as "could not check" and fails the PR closed.
async function getUser(login) {
  const res = await api(`/users/${encodeURIComponent(login)}`);
  if (!res.ok) throw new Error(`GET /users/${login} -> ${res.status}`);
  const u = await res.json();
  return { created_at: u.created_at, public_repos: u.public_repos };
}

// Counted from domains/ itself rather than the owners/ index, because domains/
// is the registry — the index is derived data rebuilt after merge by
// sync-owners, and a stale or missing index must never read as "owns nothing"
// and hand out a second name.
async function countOwnedNames(login) {
  const res = await api(`/repos/${REPO}/contents/domains?ref=${BASE_SHA}`);
  if (!res.ok) throw new Error(`GET domains/ -> ${res.status}`);
  const entries = await res.json();
  const records = entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'));

  const target = login.toLowerCase();
  let owned = 0;

  // Modest concurrency: enough to keep a few hundred records quick, low enough
  // not to trip secondary rate limits on a shared Actions IP.
  const BATCH = 10;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const parsed = await Promise.all(slice.map(async (entry) => {
      const filePath = `domains/${entry.name}`;
      const r = await api(`/repos/${REPO}/contents/${filePath}?ref=${BASE_SHA}`);
      if (!r.ok) throw new Error(`GET ${filePath} -> ${r.status}`);
      const body = await r.json();
      return parseRecordFile(filePath, Buffer.from(body.content, 'base64').toString('utf8'));
    }));
    for (const rec of parsed) {
      if (String(rec?.owner?.github ?? '').toLowerCase() === target) owned += 1;
    }
  }

  return owned;
}

const prRes = await api(`/repos/${REPO}/pulls/${PR}`);
if (!prRes.ok) {
  console.error(`validate-pr: failed to fetch PR #${PR} from ${REPO}: ${prRes.status} ${prRes.statusText}`);
  process.exit(1);
}
const { user } = await prRes.json();

const filesRes = await api(`/repos/${REPO}/pulls/${PR}/files`);
if (!filesRes.ok) {
  console.error(`validate-pr: failed to fetch changed files for PR #${PR}: ${filesRes.status} ${filesRes.statusText}`);
  process.exit(1);
}
const files = await filesRes.json();

// A RecordParseError is a finding about the pull request, not a crash, so it
// is reported through the same channel as every other finding below. Anything
// else escaping validateChangeset is genuinely unexpected and still fails
// loudly with its stack, which is what a maintainer needs to debug it.
let result;
try {
  result = await validateChangeset({
    files: files.map((f) => ({
      filename: f.filename,
      status: f.status,
      previous_filename: f.previous_filename,
    })),
    prAuthor: user.login,
    readFile: (p) => readAt(p, HEAD_SHA),
    readBase: (p) => readAt(p, BASE_SHA),
    getUser,
    countOwnedNames,
  });
} catch (err) {
  if (!(err instanceof RecordParseError)) throw err;
  console.error('Registry validation failed:');
  console.error(`  - ${err.message}`);
  process.exit(1);
}

if (!result.ok) {
  console.error('Registry validation failed:');
  for (const err of result.errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log('Registry validation passed.');
