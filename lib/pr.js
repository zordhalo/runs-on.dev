import { validateName } from './name.js';
import { validateRecord } from './schema.js';
import { isReserved } from './blocklist.js';
import { checkEligibility } from './eligibility.js';
import { MAX_NAMES_PER_ACCOUNT } from './claim.js';
import { sameLogin, validateEdit } from './edit.js';

const DOMAIN_FILE = /^domains\/([a-z0-9-]+)\.json$/;

// Raised when a record file cannot be parsed at all, so the caller can tell a
// contributor's stray brace apart from an internal fault and report it as the
// review finding it is.
export class RecordParseError extends Error {
  constructor(path, cause) {
    super(`${path} is not valid JSON: ${cause.message}`);
    this.name = 'RecordParseError';
    this.path = path;
    this.cause = cause;
  }
}

// Hand-editing the JSON is the documented way to change a record, so a stray
// brace is a routine contributor mistake rather than a broken pipeline. Left
// as a bare JSON.parse it throws out of the whole validation run, replacing
// the list of findings with a Node stack trace -- which is precisely the
// state that leaves someone unable to see what is wrong with their own pull
// request. Parsing through here turns it back into a reportable error.
export function parseRecordFile(path, text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new RecordParseError(path, err);
  }
}
// The five gates /api/claim applies through evaluateClaim, re-applied here.
// A pull request is now a first-class way to claim a name, which means this
// branch is a second front door onto the same registry — if it checks any
// fewer of them, the way to bypass a gate is simply to open a PR instead of
// using the site. Kept in the same order as evaluateClaim so the two read
// side by side.
async function validateNewClaim({ head, name, prAuthor, getUser, countOwnedNames, now }) {
  const errors = [];

  // A record is owned by whoever the file says owns it, so a PR may only
  // introduce one naming its own author. Without this, anyone could open a
  // PR claiming a name on behalf of another account and burn that account's
  // one-name allowance.
  if (!sameLogin(head.owner?.github, prAuthor)) {
    errors.push(`a claim must name its own author as owner (@${prAuthor})`);
    // Every remaining gate is scoped to the author, so checking them against
    // a record that claims to be someone else's would report nonsense.
    return errors;
  }

  const reserved = isReserved(name);
  if (reserved.reserved) {
    errors.push(`${name} is reserved (${reserved.list})`);
  }

  // claimedAt is the moment the name was taken. A future timestamp is either
  // a mistake or an attempt to win a tie-break against a later claim.
  const claimedAt = Date.parse(head.claimedAt);
  if (!Number.isNaN(claimedAt) && claimedAt > now.getTime() + 60_000) {
    errors.push('claimedAt cannot be in the future');
  }

  // Both lookups fail closed. An unavailable GitHub API or a rate limit must
  // never read as "eligible" or "owns nothing" — load is exactly when a land
  // grab happens, which is the same reasoning /api/claim uses when it answers
  // busy rather than letting an uncounted claim through.
  let user;
  try {
    user = await getUser(prAuthor);
  } catch {
    return [...errors, 'could not check account eligibility, try re-running this check'];
  }
  if (!user) {
    return [...errors, 'could not check account eligibility, try re-running this check'];
  }

  const eligible = checkEligibility(user, now);
  if (!eligible.ok) {
    errors.push(eligible.reason === 'age'
      ? 'account must be at least 30 days old to claim a name'
      : 'account must have at least one public repository to claim a name');
  }

  let owned;
  try {
    owned = await countOwnedNames(prAuthor);
  } catch {
    return [...errors, 'could not check how many names you already own, try re-running this check'];
  }
  if (!Number.isInteger(owned)) {
    return [...errors, 'could not check how many names you already own, try re-running this check'];
  }

  if (owned >= MAX_NAMES_PER_ACCOUNT) {
    errors.push(`one name per account: @${prAuthor} already owns ${owned}`);
  }

  return errors;
}

export async function validateChangeset({
  files,
  prAuthor,
  readFile,
  readBase,
  getUser,
  countOwnedNames,
  now = new Date(),
}) {
  const errors = [];

  if (!Array.isArray(files) || files.length !== 1) {
    return { ok: false, errors: ['a pull request must change exactly one file'] };
  }

  const [file] = files;

  // A rename arrives as ONE file entry carrying only the new path, so without this the
  // changeset falls into the new-record branch and never checks who owned the old file.
  // That lets anyone rename someone else's record into a name they own, deleting the
  // victim's registration with no ownership check at all.
  if (file.status === 'renamed' || file.previous_filename) {
    return { ok: false, errors: ['renaming a record is not allowed'] };
  }

  const match = DOMAIN_FILE.exec(file.filename);
  if (!match) {
    return { ok: false, errors: [`only domains/<name>.json may be changed, got ${file.filename}`] };
  }

  const nameFromPath = match[1];
  const base = await readBase(file.filename);

  // POLICY.md promises phishing/malware names get pulled without notice, which
  // requires an owner (or a maintainer) to be able to release a name by PR. The
  // head file no longer exists once removed, so this must branch before readFile.
  if (file.status === 'removed') {
    if (!base) return { ok: false, errors: ['could not read the record being removed'] };
    if (!sameLogin(base.owner?.github, prAuthor)) {
      errors.push(`only the owner (@${base.owner?.github}) may remove this record`);
    }
    return { ok: errors.length === 0, errors };
  }

  const head = await readFile(file.filename);
  if (!head) return { ok: false, errors: ['could not read the changed file'] };

  if (!validateName(nameFromPath).ok) errors.push('filename fails the name grammar');
  if (head.name !== nameFromPath) errors.push('filename must match the record name');

  // Changing an existing record is the same operation the site's editor
  // performs, so it is gated by the same shared validator rather than a
  // second copy of the rules here. validateEdit runs the schema check for
  // this branch; the new-claim branch runs its own, so every path validates
  // the record exactly once.
  if (base) {
    errors.push(...validateEdit({ base, head, editor: prAuthor }).errors);
  } else {
    const schema = validateRecord(head);
    if (!schema.ok) errors.push(...schema.errors);

    errors.push(...await validateNewClaim({
      head,
      name: nameFromPath,
      prAuthor,
      getUser,
      countOwnedNames,
      now,
    }));
  }

  return { ok: errors.length === 0, errors };
}
