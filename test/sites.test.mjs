import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDeployment, rollbackTo, newDeployment,
  MAX_DEPLOYMENTS_KEPT,
} from '../lib/sites.js';

const at = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString();

function deployment(i) {
  return { id: `d${i}`, at: at(i), files: 3, bytes: 1024 };
}

test('the first deploy creates the record with the deployment active', () => {
  const d = deployment(1);
  const { record, pruned } = applyDeployment(null, { name: 'foo', owner: 'hawkay002', deployment: d });
  assert.deepEqual(record, {
    name: 'foo',
    owner: 'hawkay002',
    active: 'd1',
    deployments: [d],
    updatedAt: d.at,
  });
  assert.deepEqual(pruned, []);
});

test('later deploys append, keep the original owner, and stay capped', () => {
  const first = applyDeployment(null, { name: 'foo', owner: 'hawkay002', deployment: deployment(1) });
  let record = first.record;
  for (let i = 2; i <= MAX_DEPLOYMENTS_KEPT + 2; i++) {
    record = applyDeployment(record, { name: 'foo', owner: 'whoever', deployment: deployment(i) }).record;
  }

  assert.equal(record.deployments.length, MAX_DEPLOYMENTS_KEPT);
  assert.deepEqual(record.deployments.map((d) => d.id), ['d3', 'd4', 'd5', 'd6', 'd7']);
  assert.equal(record.active, 'd7');
  // The owner on record is who claimed it, not who last deployed — for a
  // single-owner v1 they are the same login, but the record must not become
  // re-ownable by deploying at it.
  assert.equal(record.owner, 'hawkay002');
});

test('deploying reports the deployments that fell out of history', () => {
  const first = applyDeployment(null, { name: 'foo', owner: 'a', deployment: deployment(1) });
  let prunedTotal = [];
  let record = first.record;
  for (let i = 2; i <= 7; i++) {
    const step = applyDeployment(record, { name: 'foo', owner: 'a', deployment: deployment(i) });
    record = step.record;
    prunedTotal = prunedTotal.concat(step.pruned);
  }
  assert.deepEqual(prunedTotal.map((d) => d.id), ['d1', 'd2']);
});

test('rollback points at a deployment still in history', () => {
  const record = {
    name: 'foo',
    owner: 'a',
    active: 'd3',
    deployments: [deployment(1), deployment(2), deployment(3)],
    updatedAt: at(3),
  };
  const rolled = rollbackTo(record, 'd1', { now: new Date(Date.UTC(2026, 0, 9)) });
  assert.equal(rolled.active, 'd1');
  assert.equal(rolled.deployments.length, 3);
  assert.equal(rolled.updatedAt, new Date(Date.UTC(2026, 0, 9)).toISOString());
});

test('rollback refuses a deployment that is not in history', () => {
  const record = { name: 'foo', owner: 'a', active: 'd1', deployments: [deployment(1)], updatedAt: at(1) };
  assert.equal(rollbackTo(record, 'gone'), null);
  assert.equal(rollbackTo(null, 'd1'), null);
  // Rolling back to the already-active deployment is a harmless no-op write
  // the caller can compare and skip.
  assert.equal(rollbackTo(record, 'd1')?.active, 'd1');
});

test('newDeployment mints distinct ids and records shape', () => {
  const a = newDeployment({ files: 2, bytes: 10 });
  const b = newDeployment({ files: 2, bytes: 10 });
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^[0-9a-f]{8}$/);
  assert.equal(a.files, 2);
  assert.equal(a.bytes, 10);
  assert.equal(typeof a.at, 'string');
});
