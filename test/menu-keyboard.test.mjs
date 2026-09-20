import test from 'node:test';
import assert from 'node:assert/strict';

import { menuFocusTarget } from '../lib/menu-keyboard.js';

const items = [{ id: 'first' }, { id: 'middle' }, { id: 'last' }];

test('menu arrows move to the adjacent item', () => {
  assert.equal(menuFocusTarget(items, items[0], 'ArrowDown'), items[1]);
  assert.equal(menuFocusTarget(items, items[2], 'ArrowUp'), items[1]);
});

test('menu arrows wrap at both ends', () => {
  assert.equal(menuFocusTarget(items, items[2], 'ArrowDown'), items[0]);
  assert.equal(menuFocusTarget(items, items[0], 'ArrowUp'), items[2]);
});

test('menu arrows enter at the appropriate end when focus is outside', () => {
  assert.equal(menuFocusTarget(items, null, 'ArrowDown'), items[0]);
  assert.equal(menuFocusTarget(items, null, 'ArrowUp'), items[2]);
});

test('Home and End jump to the menu bounds', () => {
  assert.equal(menuFocusTarget(items, items[1], 'Home'), items[0]);
  assert.equal(menuFocusTarget(items, items[1], 'End'), items[2]);
});

test('unhandled keys and empty menus do not move focus', () => {
  assert.equal(menuFocusTarget(items, items[1], 'Tab'), null);
  assert.equal(menuFocusTarget([], null, 'ArrowDown'), null);
});
