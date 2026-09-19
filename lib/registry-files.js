// Disk twin of lib/registry.js: the registry is a directory of JSON files in
// this repo, so anything computing over the full registry at build time (or
// on the server, memoised) reads it straight off disk instead of paying the
// GitHub contents API for what a readdir already knows. Static pages get the
// read for free at build; a dynamically rendered page shipping this read must
// also list the directory in outputFileTracingIncludes or the files never
// reach the lambda.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readRegistry(dir = join(process.cwd(), 'domains')) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}
