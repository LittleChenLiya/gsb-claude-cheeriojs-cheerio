/**
 * In-memory acceptance fixture for the remove/detach data-cleanup strategy.
 *
 * Parent and child data nodes are removed vs. detached and re-inserted; data,
 * sibling values and parent/next/prev links are checked after every step. No
 * browser or files are involved.
 *
 * Run with:
 *   node --import=tsx scripts/verify-detach-data.mts
 */
import assert from 'node:assert/strict';
import { load } from '../src/load-parse.js';

type Row = Record<string, unknown>;
const report: Row = {};

/*
 * Fixture (kept entirely in memory):
 * <ul><li class="parent"><b class="child">x</b></li>
 *     <li class="sibling">s</li></ul>
 */
const $ = load(
    '<ul id="root"><li class="parent">P<b class="child">C</b></li>' +
      '<li class="sibling">S</li></ul>',
  );
  const $ul = $('#root');
  const $parent = $('.parent');
  const $child = $('.child');
  const $sibling = $('.sibling');

// Seed internal data on parent, descendant and sibling.
$parent.data('role', 'parent');
$child.data('role', 'child');
$sibling.data('role', 'sibling');

// --- 1. detach(): keep data, reset DOM links ------------------------------
const detached = $parent.detach();

assert.equal($ul.children().length, 1, 'detach leaves the sibling only');
assert.equal(detached.data('role'), 'parent', 'detached parent keeps data');
assert.equal($child.data('role'), 'child', 'detached descendant keeps data');
assert.equal(
  $sibling.data('role'),
  'sibling',
  'sibling data is untouched by detach',
);
assert.equal(detached[0].parent, null, 'detached parent link reset');
assert.equal(detached[0].prev, null, 'detached prev link reset');
assert.equal(detached[0].next, null, 'detached next link reset');
assert.equal($sibling[0].prev, null, 'sibling re-linked (no prev)');
assert.equal($sibling[0].next, null, 'sibling re-linked (no next)');

// --- 2. re-insert: data survives and DOM links follow the move ------------
detached.appendTo($ul);

assert.equal($ul.children().length, 2, 're-insert restores child count');
assert.equal(
  detached[0].parent,
  $ul[0],
  're-inserted node is linked to its parent',
);
assert.equal(
  detached[0].prev,
  $sibling[0],
  're-inserted node follows the sibling',
);
assert.equal($sibling[0].next, detached[0], 'sibling points back');
assert.equal(detached[0].next, null, 're-inserted node is last');
assert.equal(
  detached.data('role'),
  'parent',
  'parent data readable after re-insertion',
);
assert.equal(
  $child.data('role'),
  'child',
  'descendant data readable after re-insertion',
);
assert.equal($sibling.data('role'), 'sibling', 'sibling data unchanged');

report['detachAndReinsert'] = {
  parentData: detached.data('role'),
  childData: $child.data('role'),
  siblingData: $sibling.data('role'),
  parentLinkedToUl: detached[0].parent === $ul[0],
  siblingNextIsParent: $sibling[0].next === detached[0],
};

// Existing selection created before removal cannot read stale data.
const staleSelection = detached;

// --- 3. remove({}): default cleanup covers descendants, not siblings ------
staleSelection.remove();

assert.equal(
  staleSelection.data('role'),
  undefined,
  'removed selection cannot read old data',
);
assert.equal(
  $child.data('role'),
  undefined,
  'removed descendant data is cleared',
);
assert.equal(
  $sibling.data('role'),
  'sibling',
  'sibling data survives sibling removal',
);
assert.equal($ul.children().length, 1, 'only the sibling remains');
assert.equal(staleSelection[0].parent, null, 'removed parent link reset');
assert.equal($sibling[0].next, null, 'sibling link repaired after remove');
assert.equal($sibling[0].prev, null, 'sibling link repaired before remove');

report['removeCleanup'] = {
  staleParentData: staleSelection.data('role') ?? null,
  staleChildData: $child.data('role') ?? null,
  siblingData: $sibling.data('role'),
  parentUnlinked: staleSelection[0].parent === null,
  siblingAlone: $ul.children().length === 1,
};

// --- 4. move through the existing data flow keeps data --------------------
const $2 = load(
    '<ol id="dest"></ol><ul><li class="a">A</li><li class="b">B</li></ul>',
  );
  const $a = $2('.a').data('marker', 'move-with-node');

// Moving an existing node (not cloning) goes through the same removal path.
$a.appendTo('#dest');

assert.equal($a.data('marker'), 'move-with-node', 'moved node keeps data');
assert.equal(
  $a[0].parent,
  $2('#dest')[0],
  'moved node linked to its new parent',
);
assert.equal($2('ul li').length, 1, 'old location repaired after move');
assert.equal($2('.b')[0].prev, null, 'remaining sibling re-linked');

report['moveThroughAppendTo'] = {
  dataKept: $a.data('marker'),
  linkedToNewParent: $a[0].parent === $2('#dest')[0],
  oldLocationRepaired: $2('ul li').length === 1,
};

console.log(JSON.stringify(report, null, 2));
console.log('\nAll assertions passed.');
