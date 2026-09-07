// Spam comment moderation for the runs-on.dev registry.
//
// Checks every issue comment and PR review comment for known spam domains,
// deletes matching comments, and (if an admin token is configured) blocks
// the commenter from the repository.
//
// Runs from .github/workflows/moderate.yml on a schedule and on new
// comment events. See the workflow file for the required secrets.

const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN; // optional: enables blocking

if (!REPO || !TOKEN) {
  console.error('moderate: GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  process.exit(1);
}

const api = (path, init = {}, token = TOKEN) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers,
    },
  });

// Domains and patterns that are spam in this repo's context. Each entry is
// a regex tested against the comment body. Add new patterns here; the
// workflow picks them up on the next run without any other change.
const SPAM_PATTERNS = [
  /go-live\.me/i,
  /golive\.me/i,
];

function isSpam(body) {
  return SPAM_PATTERNS.some((pattern) => pattern.test(body));
}

// A comment by a bot or the owner is never spam, even if it quotes a spam
// link while reporting or discussing it. The workflow's own GITHUB_TOKEN
// identity is `github-actions[bot]`.
const EXEMPT_LOGINS = new Set([
  'github-actions[bot]',
  'zordhalo',
]);

async function collectIssueComments() {
  const comments = [];
  let page = 1;
  for (;;) {
    const res = await api(`/repos/${REPO}/issues/comments?per_page=100&page=${page}&sort=created&direction=desc`);
    if (!res.ok) throw new Error(`list issue comments page ${page}: ${res.status}`);
    const body = await res.json();
    if (body.length === 0) break;
    comments.push(...body);
    if (body.length < 100) break;
    page += 1;
  }
  return comments;
}

async function collectPRReviewComments() {
  const comments = [];
  let page = 1;
  for (;;) {
    const res = await api(`/repos/${REPO}/pulls/comments?per_page=100&page=${page}&sort=created&direction=desc`);
    if (!res.ok) throw new Error(`list PR review comments page ${page}: ${res.status}`);
    const body = await res.json();
    if (body.length === 0) break;
    comments.push(...body);
    if (body.length < 100) break;
    page += 1;
  }
  return comments;
}

async function deleteIssueComment(id) {
  const res = await api(`/repos/${REPO}/issues/comments/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete issue comment ${id}: ${res.status}`);
}

async function deletePRReviewComment(id) {
  const res = await api(`/repos/${REPO}/pulls/comments/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`delete PR review comment ${id}: ${res.status}`);
}

// Blocks the user from the repository owner's account, which removes their
// access to the repo and hides their existing interactions. Requires an
// admin-scoped PAT (ADMIN_TOKEN secret); silently skipped otherwise.
async function blockUser(login) {
  if (!ADMIN_TOKEN) {
    console.log(`(blocking skipped for ${login}: no ADMIN_TOKEN configured)`);
    return false;
  }
  const res = await api(`/user/blocks/${login}`, { method: 'PUT' }, ADMIN_TOKEN);
  if (res.ok) return true;
  console.error(`block ${login}: ${res.status} ${res.statusText}`);
  return false;
}

const actions = [];

const [issueComments, prComments] = await Promise.all([
  collectIssueComments(),
  collectPRReviewComments(),
]);

for (const comment of issueComments) {
  if (EXEMPT_LOGINS.has(comment.user.login)) continue;
  if (!isSpam(comment.body)) continue;
  await deleteIssueComment(comment.id);
  console.log(`deleted issue comment ${comment.id} by ${comment.user.login}`);
  actions.push({ type: 'deleted-issue-comment', id: comment.id, author: comment.user.login, blocked: await blockUser(comment.user.login) });
}

for (const comment of prComments) {
  if (EXEMPT_LOGINS.has(comment.user.login)) continue;
  if (!isSpam(comment.body)) continue;
  await deletePRReviewComment(comment.id);
  console.log(`deleted PR review comment ${comment.id} by ${comment.user.login}`);
  actions.push({ type: 'deleted-pr-comment', id: comment.id, author: comment.user.login, blocked: await blockUser(comment.user.login) });
}

if (actions.length === 0) {
  console.log('moderate: no spam found');
} else {
  console.log(`moderate: ${actions.length} spam comment(s) removed`);
  // Emit for the workflow summary
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    const lines = [
      `# Spam moderation — ${new Date().toISOString()}`,
      '',
      ...actions.map((a) => `- ${a.type} #${a.id} by @${a.author}${a.blocked ? ' (user blocked)' : ''}`),
      '',
    ];
    await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'), 'utf8');
  }
}
