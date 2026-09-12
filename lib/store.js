import { put, list, del } from '@vercel/blob';

// The one module that knows where hosted-site bytes live. Everything above it
// speaks in `sites/<name>/<deploymentId>/...` pathnames; if the storage
// backend ever moves (R2, S3, anything), it moves here and only here.

export function storeConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Uploads a deployment's files in bounded batches rather than one request per
// file (500 round-trips) or all at once (a 500-request fan-out). 10 keeps a
// deploy of a realistic site a handful of round-trips without a burst the
// store would rather not see.
const BATCH = 10;

export async function putDeployment(prefix, entries) {
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    // allSettled, not all: Promise.all abandons its siblings on the first
    // rejection while they are still in flight, and those stray successes
    // would outlive the failure report that never mentions them.
    const settled = await Promise.allSettled(batch.map((entry) => put(
      // The trailing path is the entry name verbatim; lib/zip.js already
      // guaranteed it is a plain relative path, so it cannot escape the
      // deployment prefix.
      `${prefix}${entry.name}`,
      entry.data,
      // Hosted sites are public by definition; the deploy endpoint is the
      // gate, not the store.
      { access: 'public' },
    )));
    if (settled.some((r) => r.status === 'rejected')) {
      // A failed batch makes this deployment undeployable, so the whole
      // prefix goes — earlier batches included. Half an upload must never
      // sit publicly at a path nothing will ever reference.
      await deletePrefixes([prefix]);
      return { ok: false, uploaded: i };
    }
  }
  return { ok: true, uploaded: entries.length };
}

// Best-effort prefix delete for pruned deployments. The caller treats a
// failure as leftover storage, never as a failed deploy: the pointer already
// moved, and an orphaned prefix is reclaimable by the cleanup workflow.
export async function deletePrefixes(prefixes) {
  let deleted = 0;
  for (const prefix of prefixes) {
    try {
      let cursor;
      do {
        const page = await list({ prefix, cursor });
        if (page.blobs.length > 0) {
          await del(page.blobs.map((b) => b.url));
          deleted += page.blobs.length;
        }
        cursor = page.cursor;
      } while (cursor);
    } catch {
      // Swallow on purpose, and report what did delete.
    }
  }
  return { ok: true, deleted };
}
