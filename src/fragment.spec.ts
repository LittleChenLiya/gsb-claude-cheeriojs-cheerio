import { Element, isTag, type Text } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { insertFragment, load } from './index.js';

const THREE_TARGETS =
  '<table id="t"><tbody></tbody></table><select id="s"></select><svg id="v"></svg>';

describe('fragment insertion', () => {
  describe('three targets', () => {
    it('table: inserting a <tr> into a tbody produces a real row', () => {
      const $ = load(THREE_TARGETS);

      const receipts = $('tbody').appendFragment('<tr><td>Apple</td></tr>');

      expect(receipts).toHaveLength(1);
      const [receipt] = receipts;
      expect(receipt.target).toBe($('tbody')[0]);
      expect(receipt.index).toBe(0);
      expect(receipt.nodes).toHaveLength(1);

      const row = receipt.nodes[0];
      expect(isTag(row) && row.tagName).toBe('tr');
      expect($('tbody').children()[0]).toBe(row);
      expect($('#t').html()).toBe('<tbody><tr><td>Apple</td></tr></tbody>');
    });

    it('select: inserting an <option> works', () => {
      const $ = load(THREE_TARGETS);

      const receipts = $('select').appendFragment(
        '<option value="1">One</option>',
      );

      expect(receipts).toHaveLength(1);
      const option = $('#s').children()[0];
      expect(isTag(option) && option.tagName).toBe('option');
      expect(isTag(option) && option.attribs['value']).toBe('1');
      expect($('#s').text()).toBe('One');
      expect($('#s').html()).toBe('<option value="1">One</option>');
    });

    it('svg: fragments keep the SVG namespace', () => {
      const $ = load(THREE_TARGETS);

      const receipts = $('svg').appendFragment(
        '<circle r="1"/><foreignObject><div>x</div></foreignObject>',
      );

      expect(receipts).toHaveLength(1);
      const [circle, foreignObject] = $('#v')
        .children()
        .toArray() as (Element & {
        namespace?: string;
      })[];
      expect(circle.tagName).toBe('circle');
      expect(circle.namespace).toBe('http://www.w3.org/2000/svg');
      expect(foreignObject.tagName).toBe('foreignObject');
      expect(foreignObject.namespace).toBe('http://www.w3.org/2000/svg');

      // HTML integration point: children switch back to the HTML namespace.
      const div = foreignObject.children[0] as Element & {
        namespace?: string;
      };
      expect(div.tagName).toBe('div');
      expect(div.namespace).toBe('http://www.w3.org/1999/xhtml');
    });
  });

  describe('insertion validity', () => {
    it('rejects a fragment that the target context drops, without a partial tree', () => {
      const $ = load('<div id="d">keep</div>');

      const receipts = $('#d').appendFragment('<tr><td>x</td></tr>');

      expect(receipts).toHaveLength(0);
      // No partial tree: not even the foster-parented text is inserted.
      expect($('#d').html()).toBe('keep');
    });

    it('rejects elements that are not allowed in a select', () => {
      const $ = load('<select id="s"></select>');

      const receipts = $('#s').appendFragment('<div>bad</div>');

      expect(receipts).toHaveLength(0);
      expect($('#s').html()).toBe('');
    });

    it('rejects nodes that belong to a foreign document', () => {
      const $a = load('<div id="a"></div>');
      const $b = load('<div id="b"></div>');

      const receipts = $a($b('#b')[0]).appendFragment('<span>x</span>');

      expect(receipts).toHaveLength(0);
      expect($b('#b').html()).toBe('');
    });

    it('rejects detached nodes', () => {
      const detached = new Element('div', {});

      const receipt = insertFragment(detached, '<span>x</span>');

      expect(receipt).toBeNull();
      expect(detached.children).toHaveLength(0);
    });

    it('rejects non-element targets', () => {
      const $ = load('<div id="d">text</div>');
      const textNode = $('#d')[0].children[0];

      const receipt = insertFragment(textNode, '<span>x</span>');

      expect(receipt).toBeNull();
      expect($('#d').html()).toBe('text');
    });
  });

  describe('receipts', () => {
    it('reports the corrected position where text landed', () => {
      const $ = load('<div id="d"><b>old</b></div>');

      const [receipt] = $('#d').appendFragment(' text ');

      expect(receipt.target).toBe($('#d')[0]);
      expect(receipt.index).toBe(1);
      expect(receipt.nodes).toHaveLength(1);
      expect((receipt.nodes[0] as Text).data).toBe(' text ');
      expect($('#d').html()).toBe('<b>old</b> text ');
    });

    it('returns one receipt per modified target', () => {
      const $ = load('<ul><li>a</li><li>b</li></ul>');

      const receipts = $('li').appendFragment('<i>x</i>');

      expect(receipts).toHaveLength(2);
      expect(receipts[0].index).toBe(1);
      expect(receipts[1].index).toBe(1);
      expect($('li i')).toHaveLength(2);
    });
  });

  describe('parsing mode', () => {
    it('parses with scripting disabled (noscript content becomes inert markup)', () => {
      const $ = load('<div id="d"></div>');

      $('#d').appendFragment('<noscript><b>hi</b></noscript>');

      expect($('#d noscript b')).toHaveLength(1);
    });

    it('does not mutate the instance options', () => {
      const $ = load('<div id="d"></div>');

      $('#d').appendFragment('<span>x</span>');

      expect($._options.scriptingEnabled).not.toBe(false);
    });
  });

  describe('node-directed insertFragment', () => {
    it('table: inserting a <tr> into a tbody produces a real row', () => {
      const $ = load(THREE_TARGETS);

      const receipt = insertFragment($('tbody')[0], '<tr><td>Apple</td></tr>');

      expect(receipt).not.toBeNull();
      expect(receipt?.index).toBe(0);
      expect($('#t').html()).toBe('<tbody><tr><td>Apple</td></tr></tbody>');
    });

    it('select: inserting an <option> works', () => {
      const $ = load(THREE_TARGETS);

      const receipt = insertFragment(
        $('select')[0],
        '<option value="1">One</option>',
      );

      expect(receipt).not.toBeNull();
      expect($('#s').html()).toBe('<option value="1">One</option>');
    });

    it('svg: fragments keep the SVG namespace', () => {
      const $ = load(THREE_TARGETS);

      const receipt = insertFragment($('svg')[0], '<circle r="1"/>');

      expect(receipt).not.toBeNull();
      const circle = $('#v').children()[0] as Element & {
        namespace?: string;
      };
      expect(circle.tagName).toBe('circle');
      expect(circle.namespace).toBe('http://www.w3.org/2000/svg');
    });

    it('rejects illegal targets without a partial tree', () => {
      const $ = load('<div id="d">keep</div>');

      const receipt = insertFragment($('#d')[0], '<tr><td>x</td></tr>');

      expect(receipt).toBeNull();
      expect($('#d').html()).toBe('keep');
    });
  });

  describe('existing interfaces', () => {
    it('keeps the original append interface working', () => {
      const $ = load('<ul></ul>');

      const result = $('ul').append('<li>a</li>');

      expect(result[0].tagName).toBe('ul');
      expect($('ul li')).toHaveLength(1);
    });
  });
});
