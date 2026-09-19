import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geoPlacement } from '../lib/geo-placement.js';

const record = (name, login, country) => ({
  name,
  owner: { github: login },
  claimedAt: '2026-09-01T00:00:00.000Z',
  records: {},
  ...(country ? { country } : {}),
});

const centroids = { FR: [46.6, 2.4], IN: [22, 79] };

test('places owners from the claim-time country, case-insensitively', () => {
  const { points, resolved, total } = geoPlacement([record('lucas', 'Zordhalo', 'FR')], {}, centroids);
  assert.deepEqual(points, { zordhalo: [46.6, 2.4] });
  assert.equal(resolved, 1);
  assert.equal(total, 1);
});

test('falls back to the geocode enrichment for records without a country', () => {
  const { points, resolved } = geoPlacement(
    [record('lucas', 'zordhalo')],
    { Zordhalo: [51.5, -0.13], ghost: [1, 1] },
    centroids,
  );
  assert.deepEqual(points, { zordhalo: [51.5, -0.13] });
  assert.equal(resolved, 1);
});

test('drops owners who released their name and counts every current one', () => {
  const { points, resolved, total } = geoPlacement(
    [record('lucas', 'zordhalo', 'FR'), record('nova', 'psycho14009')],
    { zordhalo: [48.85, 2.35], psycho14009: [null, null], departed: [10, 10] },
    {},
  );
  assert.deepEqual(points, { zordhalo: [48.85, 2.35] });
  assert.equal(resolved, 1);
  // psycho14009 is current but unplaced; departed is gone either way.
  assert.equal(total, 2);
});

test('counts an owner with several names once', () => {
  const { total, resolved } = geoPlacement(
    [record('lucas', 'zordhalo', 'FR'), record('lucas2', 'zordhalo', 'FR')],
    {},
    centroids,
  );
  assert.equal(total, 1);
  assert.equal(resolved, 1);
});

test('malformed inputs count toward nothing and cannot crash the page', () => {
  const { points, resolved, total } = geoPlacement(
    [record('lucas', 'zordhalo', 'XX'), record('nova', null), null],
    { zordhalo: 'not-a-point' },
    'not-a-table',
  );
  assert.deepEqual(points, {});
  assert.equal(resolved, 0);
  assert.equal(total, 1);
});
