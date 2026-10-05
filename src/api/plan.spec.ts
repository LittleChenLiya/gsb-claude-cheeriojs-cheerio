import type { AnyNode } from 'domhandler';
import { beforeEach, describe, expect, it } from 'vitest';
import { type CheerioAPI, load } from '../index.js';

describe('$.plan', () => {
  let $: CheerioAPI;

  beforeEach(() => {
    $ = load(
      '<div id="root"><span class="a">A</span><span class="b">B</span><span class="c">C</span><span class="d">D</span></div>',
    );
  });

  it('modifies every node in the set', () => {
    const result = $.plan($('span')).addClass('hit').commit();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(4);
    for (const span of $('span').toArray()) {
      expect(span.attribs['class']).toContain('hit');
    }
  });

  it('deduplicates nodes selected by two selectors', () => {
    const spans = $('span').toArray();
    const first = spans[0];

    const result = $.plan([first, first]).attr('data-x', '1').commit();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(first.attribs['data-x']).toBe('1');
  });

  it('does not execute twice on duplicate selector results', () => {
    const result = $.plan([$('.a'), $('.a')])
      .addClass('dup')
      .commit();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(1);
    expect($('.a').attr('class')).toBe('a dup');
  });

  it('orders ancestors before descendants and keeps associations', () => {
    const root = $('#root')[0];
    const child = $('.a')[0];

    const result = $.plan([child, root]).attr('data-order', '1').commit();

    expect(result.ok).toBe(true);
    // The ancestor is reported first.
    expect(result.results[0].node).toBe(root);
    expect(result.results[1].node).toBe(child);
    // The parent-child association is preserved.
    expect(child.parent).toBe(root);
    expect(root.children).toContain(child);
  });

  it('rejects cross-document nodes without partial modification', () => {
    const other = load('<div><span class="foreign"></span></div>');
    const local = $('.a')[0];
    const foreign = other('.foreign')[0];

    const before = $.html();
    const result = $.plan([local, foreign]).attr('data-x', '1').commit();

    expect(result.ok).toBe(false);
    // No partial modification of the local document.
    expect($.html()).toBe(before);
    expect(local.attribs['data-x']).toBeUndefined();
    // The foreign node is reported as failed.
    const foreignResult = result.results.find((r) => r.node === foreign);
    expect(foreignResult?.ok).toBe(false);
  });

  it('copies cross-document nodes when policy is copy', () => {
    const other = load('<div><span class="foreign"></span></div>');
    const foreign = other('.foreign')[0];

    const result = $.plan([foreign], { crossDocument: 'copy' })
      .attr('data-x', '1')
      .commit();

    expect(result.ok).toBe(true);
    // The original foreign document is untouched.
    expect(other('.foreign').attr('data-x')).toBeUndefined();
  });

  it('accepts an empty set as a legal empty plan', () => {
    const result = $.plan($()).commit();

    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('directs commands at specific nodes with at()', () => {
    const first = $('.a')[0];
    const second = $('.b')[0];

    const result = $.plan($('span'))
      .at(first)
      .addClass('only-first')
      .at(second)
      .addClass('only-second')
      .commit();

    expect(result.ok).toBe(true);
    expect(first.attribs['class']).toBe('a only-first');
    expect(second.attribs['class']).toBe('b only-second');
    expect($('.c').attr('class')).toBe('c');
  });

  it('reports per-node results', () => {
    const result = $.plan($('span')).attr('data-x', '1').commit();

    expect(result.results).toHaveLength(4);
    for (const r of result.results) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.node).toBeDefined();
    }
  });

  it('rejects attribute operations on non-element nodes before modifying', () => {
    const textNode = $('.a')[0].children[0] as AnyNode;
    const before = $.html();

    const result = $.plan([textNode]).attr('data-x', '1').commit();

    expect(result.ok).toBe(false);
    expect($.html()).toBe(before);
  });

  it('rejects text operations on non-element nodes before modifying', () => {
    const textNode = $('.a')[0].children[0] as AnyNode;
    const before = $.html();

    const result = $.plan([textNode]).text('changed').commit();

    expect(result.ok).toBe(false);
    expect($.html()).toBe(before);
  });

  it('applies multiple operations in order', () => {
    const result = $.plan($('.a'))
      .addClass('x')
      .removeClass('a')
      .attr('id', 'first')
      .commit();

    expect(result.ok).toBe(true);
    expect($('.a').length).toBe(0);
    expect($('#first').attr('class')).toBe('x');
  });

  it('removes nodes from the document', () => {
    const result = $.plan($('.a')).remove().commit();

    expect(result.ok).toBe(true);
    expect($('.a').length).toBe(0);
    expect($('span').length).toBe(3);
  });

  it('empties nodes', () => {
    const result = $.plan($('#root')).empty().commit();

    expect(result.ok).toBe(true);
    expect($('#root').children()).toHaveLength(0);
  });

  it('sets text content', () => {
    const result = $.plan($('.a')).text('hello').commit();

    expect(result.ok).toBe(true);
    expect($('.a').text()).toBe('hello');
  });

  it('works with a selector string', () => {
    const result = $.plan('.a').addClass('from-selector').commit();

    expect(result.ok).toBe(true);
    expect($('.a').attr('class')).toBe('a from-selector');
  });

  it('works with a single node', () => {
    const node = $('.a')[0];
    const result = $.plan(node).attr('data-single', '1').commit();

    expect(result.ok).toBe(true);
    expect(node.attribs['data-single']).toBe('1');
  });

  it('exposes the deduped and ordered nodes', () => {
    const root = $('#root')[0];
    const child = $('.a')[0];
    const plan = $.plan([child, root, child]);

    expect(plan.nodes).toHaveLength(2);
    expect(plan.nodes[0]).toBe(root);
    expect(plan.nodes[1]).toBe(child);
  });
});

describe('$.plan html operation', () => {
  it('sets inner HTML', () => {
    const $ = load('<div><span class="a">A</span></div>');
    const result = $.plan($('div')).html('<p>Hello</p>').commit();

    expect(result.ok).toBe(true);
    expect($('div').html()).toBe('<p>Hello</p>');
    expect($('p').text()).toBe('Hello');
  });
});
