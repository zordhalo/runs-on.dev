import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../lib/throttle.js';

test('allows up to max within the window', () => {
  const take = createRateLimiter({ windowMs: 1000, max: 3 });
  assert.equal(take('a', 0).ok, true);
  assert.equal(take('a', 1).ok, true);
  assert.equal(take('a', 2).ok, true);
  assert.equal(take('a', 3).ok, false);
});

test('keys are independent, so one account cannot throttle another', () => {
  const take = createRateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(take('a', 0).ok, true);
  assert.equal(take('a', 1).ok, false);
  assert.equal(take('b', 1).ok, true);
});

test('allowance returns as the window slides', () => {
  const take = createRateLimiter({ windowMs: 1000, max: 2 });
  take('a', 0);
  take('a', 500);
  assert.equal(take('a', 900).ok, false);
  // The hit at t=0 has aged out by t=1001.
  assert.equal(take('a', 1001).ok, true);
});

test('reports how long until the next slot frees up', () => {
  const take = createRateLimiter({ windowMs: 1000, max: 1 });
  take('a', 0);
  const denied = take('a', 400);
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterMs, 600);
});

test('retryAfterMs is never negative', () => {
  const take = createRateLimiter({ windowMs: 1000, max: 1 });
  take('a', 0);
  assert.ok(take('a', 0).retryAfterMs >= 0);
});

test('does not grow without bound', () => {
  const take = createRateLimiter({ windowMs: 10, max: 1 });
  // Every key ages out well before the sweep threshold is crossed.
  for (let i = 0; i < 6000; i += 1) take(`k${i}`, 1_000_000 + i);
  assert.equal(take('fresh', 2_000_000).ok, true);
});
