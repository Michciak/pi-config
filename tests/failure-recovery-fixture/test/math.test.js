import test from 'node:test';
import assert from 'node:assert/strict';
import { add, percentage } from '../src/math.js';

test('adds positive and negative numbers', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(add(-2, 3), 1);
});

test('calculates a percentage rate', () => {
  assert.equal(percentage(200, 0.15), 30);
  assert.equal(percentage(80, 0.25), 20);
});
