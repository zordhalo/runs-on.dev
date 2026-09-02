import { validateRecord } from './schema.js';

// GitHub logins are unique case-insensitively, so `Zyaxxy` and `zyaxxy` are the
// same account. Comparing them raw would let a record written with one casing
// lock its own owner out of editing it.
export function sameLogin(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && a.toLowerCase() === b.toLowerCase();
}

// The complete gate for changing a record that already exists, shared by the
// two write paths onto the registry: CI reviewing a pull request (lib/pr.js)
// and the signed-in editor on the site (app/api/records). Both reach the same
// files with the same consequences -- a record points a name other people
// trust at somewhere on the internet -- so they must not be allowed to drift
// into enforcing different rules. Whichever front door is easier to get
// through is the only one an attacker would ever use.
//
// Assumes nothing about how `editor` was authenticated: the PR path takes the
// pull request's author, the site takes the signed-in session's login.
export function validateEdit({ base, head, editor }) {
  const errors = [];

  if (!base) {
    return { ok: false, errors: ['no existing record to change'] };
  }

  // Ownership first, and reported alone. Every rule below describes how the
  // record may differ from its base, which is a detail the person editing it
  // has no business learning about a record that isn't theirs.
  if (!sameLogin(base.owner?.github, editor)) {
    return { ok: false, errors: [`only the owner (@${base.owner?.github}) may change this record`] };
  }

  const schema = validateRecord(head);
  if (!schema.ok) errors.push(...schema.errors);

  // The three immutable fields. `owner` and `claimedAt` are the record's
  // identity -- who holds the name and since when -- and `name` is what the
  // file is called, so changing it is a rename, which is refused outright
  // rather than performed as a delete-and-recreate that would drop the name
  // back into the pool for the length of one commit.
  if (!sameLogin(head.owner?.github, base.owner?.github)) {
    errors.push('owner cannot be changed');
  }
  if (head.claimedAt !== base.claimedAt) {
    errors.push('claimedAt cannot be changed');
  }
  if (head.name !== base.name) {
    errors.push('name cannot be changed; claim a new name instead');
  }

  return { ok: errors.length === 0, errors };
}

// Key order in a JSON object carries no meaning, but the client rebuilds the
// records object from form fields and can hand back the same record with its
// keys in a different order. Comparing canonically keeps that from reading as
// a change. Arrays stay in order: the order of A records or MX entries is
// part of what the owner wrote, so reordering them is a real edit.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

// True when committing `head` would produce a file identical to `base`. A save
// that changes nothing should not become a commit, a DNS sync, and a line in
// the log -- which is what a double-clicked button or a stuck retry produces.
export function isUnchanged(base, head) {
  return JSON.stringify(canonical(base)) === JSON.stringify(canonical(head));
}
