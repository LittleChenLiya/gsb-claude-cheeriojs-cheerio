import type { Element } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { fruits } from '../__fixtures__/fixtures.js';
import { load } from '../index.js';
import { createPlan } from './plan.js';

const fourNodeMarkup = [
  '<div id="root">',
  '<p class="item">one</p>',
  '<p class="item">two</p>',
  '<section id="sub"><span class="item">three</span></section>',
  '</div>',
].join('');

describe('ModificationPlan', () => {
  describe('de-duplication by real node identity', () => {
    it('should modify a node matched by two selectors only once', () => {
      const $ = load(fruits);
      const result = createPlan($)
        .select('.apple', 'li', '#fruits .apple')
        .addClass('seen')
        .setAttr('data-count', '1')
        .apply();

      expect(result.status).toBe('applied');
      /*
       * `.apple` is matched by all three selectors, the other `li`s by one:
       * 3 unique nodes total.
       */
      expect(result.results).toHaveLength(3);

      const apple = $('.apple');
      // The class was added exactly once, not once per matching selector.
      expect(apple.attr('class')).toBe('apple seen');
      expect(apple.attr('data-count')).toBe('1');
    });

    it('should not execute commands twice for duplicated selector results', () => {
      const $ = load('<p class="a b">x</p>');
      const result = createPlan($)
        .select('.a', '.b', 'p.a', 'p.b')
        .addClass('c')
        .apply();

      expect(result.results).toHaveLength(1);
      expect($('p').attr('class')).toBe('a b c');
    });
  });

  describe('ancestor/descendant ordering and association', () => {
    it('should order ancestors before their descendants', () => {
      const $ = load(fruits);
      const result = createPlan($)
        .select('li', '#fruits')
        .setAttr('data-planned', 'yes')
        .apply();

      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(4);
      // Document order: the <ul> ancestor comes before the <li> descendants.
      expect((result.results[0].node as Element).name).toBe('ul');
      expect(
        result.results.slice(1).map((r) => (r.node as Element).name),
      ).toStrictEqual(['li', 'li', 'li']);
    });

    it('should keep ancestor/descendant associations intact', () => {
      const $ = load(fruits);
      const result = createPlan($)
        .select('#fruits', 'li')
        .addClass('planned')
        .apply();

      expect(result.status).toBe('applied');
      const ul = $('#fruits')[0];
      const items = $('li').toArray();
      expect(items).toHaveLength(3);
      for (const li of items) {
        expect(li.parent).toBe(ul);
        expect(li.attribs['class']).toContain('planned');
      }
      expect(
        ul.children.filter((c) => (c as Element).tagName === 'li'),
      ).toStrictEqual(items);
    });

    it('should preserve planned descendants when setting text on an ancestor', () => {
      const $ = load(fourNodeMarkup);
      const result = createPlan($)
        .select('#sub', '.item')
        .setText('updated')
        .apply();

      expect(result.status).toBe('applied');
      const sub = $('#sub')[0];
      const span = $('#sub span')[0];
      // The descendant was updated first, then the ancestor kept it in place.
      expect(span.parent).toBe(sub);
      expect($(span).text()).toBe('updated');
      expect($(sub).text()).toContain('updated');
      expect(sub.children).toContain(span);
    });
  });

  describe('cross-document nodes', () => {
    it('should reject the whole plan without any partial modification', () => {
      const $local = load(fruits);
      const $foreign = load('<p id="alien">foreign</p>');

      const localBefore = $local.html();
      const foreignBefore = $foreign.html();

      const result = createPlan($local)
        .select('#fruits')
        .nodes($foreign('#alien')[0])
        .setAttr('data-touched', 'yes')
        .apply();

      expect(result.status).toBe('rejected');
      expect(result.reason).toContain('different document');
      expect(result.results).toHaveLength(0);
      // Neither document was modified, not even partially.
      expect($local.html()).toBe(localBefore);
      expect($foreign.html()).toBe(foreignBefore);
      expect($local('#fruits').attr('data-touched')).toBeUndefined();
    });

    it('should copy foreign nodes with the clone strategy', () => {
      const $local = load(fruits);
      const $foreign = load(
        '<div id="wrap"><span class="inner">hello</span></div>',
      );
      const foreignDiv = $foreign('#wrap')[0];
      const foreignSpan = $foreign('.inner')[0];

      const result = createPlan($local, { crossDocument: 'clone' })
        .select('#fruits')
        .nodes(foreignDiv, foreignSpan)
        .setAttr('data-copied', 'yes')
        .apply();

      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(3);

      // The local node was modified in place.
      expect($local('#fruits').attr('data-copied')).toBe('yes');

      // The foreign document was left untouched.
      expect($foreign('#wrap').attr('data-copied')).toBeUndefined();
      expect($foreign('.inner').attr('data-copied')).toBeUndefined();

      // The copies carry the modifications and keep their association.
      const divResult = result.results.find((r) => r.source === foreignDiv);
      const spanResult = result.results.find((r) => r.source === foreignSpan);
      expect(divResult).toBeDefined();
      expect(spanResult).toBeDefined();
      const divCopy = divResult?.node as Element;
      const spanCopy = spanResult?.node as Element;
      expect(divCopy).not.toBe(foreignDiv);
      expect(divCopy.attribs['data-copied']).toBe('yes');
      expect(spanCopy.attribs['data-copied']).toBe('yes');
      // The copied span is still inside the copied div.
      expect(spanCopy.parent).toBe(divCopy);
    });
  });

  describe('validation before modification', () => {
    it('should reject illegal attribute names without modifying the DOM', () => {
      const $ = load(fruits);
      const before = $.html();

      const result = createPlan($)
        .select('#fruits', 'li')
        .setAttr('data-ok', '1')
        .setAttr('bad name', 'x')
        .apply();

      expect(result.status).toBe('invalid');
      expect(result.reason).toContain('Invalid attribute name');
      expect($.html()).toBe(before);
      expect($('#fruits').attr('data-ok')).toBeUndefined();
    });

    it('should reject attribute commands on non-element targets', () => {
      const $ = load('<p>text <b>bold</b></p>');
      const textNode = $('p')[0].children[0];
      const before = $.html();

      const result = createPlan($)
        .nodes(textNode)
        .setAttr('data-x', '1')
        .apply();

      expect(result.status).toBe('invalid');
      expect(result.reason).toContain('requires an element');
      expect($.html()).toBe(before);
    });

    it('should reject class commands with whitespace in the class name', () => {
      const $ = load(fruits);
      const before = $.html();

      const result = createPlan($)
        .select('#fruits')
        .addClass('two classes')
        .apply();

      expect(result.status).toBe('invalid');
      expect($.html()).toBe(before);
    });
  });

  describe('empty collections', () => {
    it('should treat a plan without targets as a legal empty plan', () => {
      const $ = load(fruits);
      const result = createPlan($)
        .select('.does-not-exist')
        .setAttr('data-x', '1')
        .apply();

      expect(result.status).toBe('empty');
      expect(result.results).toStrictEqual([]);
    });

    it('should treat a plan without any selection as empty', () => {
      const $ = load(fruits);
      expect(createPlan($).apply().status).toBe('empty');
    });
  });

  describe('node-directed commands', () => {
    it('should accept plain nodes, Cheerio selections and arrays', () => {
      const $ = load(fourNodeMarkup);
      const root = $('#root')[0];
      const items = $('.item');

      const result = createPlan($)
        .nodes(root, items, [$('#sub')[0]])
        .setAttr('data-directed', 'yes')
        .apply();

      expect(result.status).toBe('applied');
      // Root + 2 p.item + #sub + span.item = 5 unique nodes.
      expect(result.results).toHaveLength(5);
      expect($('#root').attr('data-directed')).toBe('yes');
      expect($('#sub').attr('data-directed')).toBe('yes');
      expect($('.item').attr('data-directed')).toBe('yes');
    });

    it('should de-duplicate nodes directed both by selector and directly', () => {
      const $ = load(fourNodeMarkup);
      const root = $('#root')[0];

      const result = createPlan($)
        .select('#root')
        .nodes(root, $('#root'))
        .addClass('once')
        .apply();

      expect(result.results).toHaveLength(1);
      expect($('#root').attr('class')).toBe('once');
    });

    it('should attribute every result to its source node', () => {
      const $ = load(fourNodeMarkup);
      const root = $('#root')[0];
      const span = $('.item')[2];

      const result = createPlan($)
        .nodes(root)
        .select('#sub span')
        .setAttr('data-a', '1')
        .addClass('c')
        .apply();

      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].source).toBe(root);
      expect(result.results[0].node).toBe(root);
      expect(result.results[0].applied).toStrictEqual(['setAttr', 'addClass']);
      expect(result.results[1].source).toBe(span);
      expect(result.results[1].node).toBe(span);
    });
  });

  describe('four-node example', () => {
    it('should apply a plan to an ancestor and its three descendants', () => {
      const $ = load(fruits);
      const result = createPlan($)
        .select('#fruits', 'li', '.apple')
        .setAttr('data-planned', 'yes')
        .addClass('planned')
        .apply();

      expect(result.status).toBe('applied');
      // Four unique nodes: <ul id="fruits"> plus the three <li> elements.
      expect(result.results).toHaveLength(4);
      expect($('#fruits').attr('data-planned')).toBe('yes');
      expect($('#fruits').attr('class')).toBe('planned');
      expect($('.apple').attr('class')).toBe('apple planned');
      expect($('.orange').attr('class')).toBe('orange planned');
      expect($('.pear').attr('class')).toBe('pear planned');
      // Associations are intact.
      expect($('#fruits').children()).toHaveLength(3);
    });
  });

  describe('text commands', () => {
    it('should set the text of elements and text nodes', () => {
      const $ = load('<p id="a">old <b>gone</b></p><p id="b">keep</p>');
      const textNode = $('#b')[0].children[0];

      const result = createPlan($)
        .select('#a')
        .nodes(textNode)
        .setText('new')
        .apply();

      expect(result.status).toBe('applied');
      expect($('#a').html()).toBe('new');
      expect($('#b').html()).toBe('new');
    });
  });

  describe('regular operation chains', () => {
    it('should not affect the regular Cheerio API', () => {
      const $ = load(fruits);
      $('.apple').addClass('chain').attr('data-chain', '1').text('Apple!');
      expect($('.apple').attr('class')).toBe('apple chain');
      expect($('.apple').attr('data-chain')).toBe('1');
      expect($('.apple').text()).toBe('Apple!');
    });
  });
});
