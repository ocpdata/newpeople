import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPreventSectionHeadingKey } from './proposalSectionHeadingGuard.js';

test('blocks Backspace at the start of a section heading', () => {
  const result = shouldPreventSectionHeadingKey('Backspace', {
    parent: { type: { name: 'heading' }, attrs: { level: 2 } },
    parentOffset: 0,
    node: () => null,
  });

  assert.equal(result, true);
});

test('blocks Backspace at the start of the paragraph immediately after a section heading', () => {
  const result = shouldPreventSectionHeadingKey('Backspace', {
    parent: { type: { name: 'paragraph' }, attrs: {} },
    parentOffset: 0,
    depth: 2,
    index: () => 1,
    node: () => ({
      child: () => ({ type: { name: 'heading' }, attrs: { level: 2 } }),
    }),
  });

  assert.equal(result, true);
});

test('allows Backspace when the cursor is not at the start of the following paragraph text', () => {
  const result = shouldPreventSectionHeadingKey('Backspace', {
    parent: { type: { name: 'paragraph' }, attrs: {} },
    parentOffset: 3,
    depth: 2,
    index: () => 1,
    node: () => ({
      child: () => ({ type: { name: 'heading' }, attrs: { level: 2 } }),
    }),
  });

  assert.equal(result, false);
});

test('blocks Enter inside a section heading', () => {
  const result = shouldPreventSectionHeadingKey('Enter', {
    parent: { type: { name: 'heading' }, attrs: { level: 2 } },
    parentOffset: 3,
    node: () => null,
  });

  assert.equal(result, true);
});
