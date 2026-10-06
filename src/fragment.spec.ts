import { Element, isText, type Text } from 'domhandler';
import { describe, expect, it } from 'vitest';
import { type FragmentReceipt, insertFragment, load } from './index.js';
import { load as slimLoad } from './slim.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

describe('appendFragment', () => {
  it('inserts a real row into a <tbody> target', () => {
    const $ = load('<table><tbody></tbody></table>');

    const [receipt] = $('tbody').appendFragment('<tr><td>Apple</td></tr>');

    expect(receipt.ok).toBe(true);
    expect(receipt.inserted).toHaveLength(1);
    expect(receipt.inserted[0]).toHaveProperty('name', 'tr');
    expect($('tbody').html()).toBe('<tr><td>Apple</td></tr>');
    expect($('tbody tr td').text()).toBe('Apple');
  });

  it('inserts options into a <select> target', () => {
    const $ = load('<select></select>');

    const [receipt] = $('select').appendFragment(
      '<option value="1">One</option>',
    );

    expect(receipt.ok).toBe(true);
    expect($('select').html()).toBe('<option value="1">One</option>');
    expect($('select option')).toHaveLength(1);
  });

  it('keeps the SVG namespace of fragments inserted into an <svg> target', () => {
    const $ = load('<svg viewBox="0 0 10 10"></svg>');

    const [receipt] = $('svg').appendFragment(
      '<circle cx="5" cy="5" r="4"/><foreignObject><div>x</div></foreignObject>',
    );

    expect(receipt.ok).toBe(true);
    const circle = $('svg').children().get(0)!;
    const foreignObject = $('svg').children().get(1)!;
    expect(circle.namespace).toBe(SVG_NAMESPACE);
    expect(foreignObject.namespace).toBe(SVG_NAMESPACE);
    // The HTML integration point switches back to the HTML namespace.
    expect((foreignObject.children[0] as Element).namespace).toBe(
      HTML_NAMESPACE,
    );
  });

  it('returns one receipt per target and inserts into each target', () => {
    const $ = load(
      '<table><tbody></tbody></table><table><tbody></tbody></table>',
    );

    const receipts = $('tbody').appendFragment('<tr><td>x</td></tr>');

    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.ok)).toBe(true);
    expect($('tbody tr')).toHaveLength(2);
  });

  it('keeps scripts inert and does not simulate browser events', () => {
    const $ = load('<div></div>');

    const [receipt] = $('div').appendFragment(
      '<script>globalThis.__cheerioFragmentPwned = true</script><b>ok</b>',
    );

    expect(receipt.ok).toBe(true);
    expect($('div script')).toHaveLength(1);
    expect(
      (globalThis as { __cheerioFragmentPwned?: boolean })
        .__cheerioFragmentPwned,
    ).toBeUndefined();
  });

  it('reports the corrected position of relocated text in the receipt', () => {
    const $ = load('<table></table>');

    const [receipt] = $('table').appendFragment('<td>hello</td>');

    expect(receipt.ok).toBe(true);
    // The parser implied a `<tbody>` and a `<tr>` around the `<td>`.
    expect(receipt.inserted).toHaveLength(1);
    expect(receipt.inserted[0]).toHaveProperty('name', 'tbody');
    expect($('table').html()).toBe('<tbody><tr><td>hello</td></tr></tbody>');

    const textCorrection = receipt.corrections.find((correction) =>
      isText(correction.node),
    );
    expect(textCorrection).toBeDefined();
    expect(isText(textCorrection!.node)).toBe(true);
    expect((textCorrection!.node as Text).data).toBe('hello');
    expect(textCorrection!.via).toStrictEqual(['tbody', 'tr']);
    expect(textCorrection!.parent).toHaveProperty('name', 'td');
    expect(textCorrection!.index).toBe(0);
    // The receipt reflects the actual final position.
    expect(textCorrection!.parent.children[textCorrection!.index]).toBe(
      textCorrection!.node,
    );
  });

  it('reports no corrections when nothing was relocated', () => {
    const $ = load('<div></div>');

    const [receipt] = $('div').appendFragment('<b>bold</b> plain');

    expect(receipt.ok).toBe(true);
    expect(receipt.corrections).toStrictEqual([]);
  });

  describe('illegal targets', () => {
    it('rejects non-element targets without producing a partial tree', () => {
      const $ = load('<div>text</div>');
      const before = $.html();

      const receipts = $('div').contents().appendFragment('<b>x</b>');

      expect(receipts).toHaveLength(1);
      expect(receipts[0].ok).toBe(false);
      expect(receipts[0].reason).toBe('not-an-element');
      expect(receipts[0].inserted).toStrictEqual([]);
      expect($.html()).toBe(before);
    });

    it('rejects void elements without producing a partial tree', () => {
      const $ = load('<div><br></div>');
      const before = $.html();

      const [receipt] = $('br').appendFragment('<b>x</b>');

      expect(receipt.ok).toBe(false);
      expect(receipt.reason).toBe('void-element');
      expect($.html()).toBe(before);
    });

    it('rejects elements from a foreign document without touching them', () => {
      const $a = load('<div id="a"></div>');
      const $b = load('<div id="b"></div>');

      const [receipt] = $a($b('#b').get(0)).appendFragment('<i>y</i>');

      expect(receipt.ok).toBe(false);
      expect(receipt.reason).toBe('foreign-document');
      expect($b('#b').html()).toBe('');
    });

    it('rejects insertions when the parser does not support contexts', () => {
      const $ = load('<div/>', { xml: true });
      const before = $.xml();

      const [receipt] = $('div').appendFragment('<b>x</b>');

      expect(receipt.ok).toBe(false);
      expect(receipt.reason).toBe('parser-mismatch');
      expect($.xml()).toBe(before);
    });

    it('rejects insertions in the slim (htmlparser2-only) build', () => {
      const $ = slimLoad('<div></div>');

      const [receipt] = $('div').appendFragment('<b>x</b>');

      expect(receipt.ok).toBe(false);
      expect(receipt.reason).toBe('parser-mismatch');
      expect($('div').html()).toBe('');
    });
  });

  it('leaves the original append interface untouched', () => {
    const $ = load('<ul><li>a</li></ul>');

    const $ul = $('ul');
    const result = $ul.append('<li>b</li>');

    expect(result).toBe($ul);
    expect($('ul').html()).toBe('<li>a</li><li>b</li>');
  });
});

describe('insertFragment (Node-directed command)', () => {
  it('inserts a real row into a <tbody> node', () => {
    const $ = load('<table><tbody></tbody></table>');

    const receipt = insertFragment(
      $('tbody').get(0)!,
      '<tr><td>Apple</td></tr>',
    );

    expect(receipt.ok).toBe(true);
    expect($('tbody').html()).toBe('<tr><td>Apple</td></tr>');
  });

  it('inserts an option into a <select> node', () => {
    const $ = load('<select></select>');

    const receipt = insertFragment(
      $('select').get(0)!,
      '<option value="1">One</option>',
    );

    expect(receipt.ok).toBe(true);
    expect($('select').html()).toBe('<option value="1">One</option>');
  });

  it('keeps the SVG namespace for fragments inserted into an <svg> node', () => {
    const $ = load('<svg viewBox="0 0 10 10"></svg>');

    const receipt = insertFragment(
      $('svg').get(0)!,
      '<rect width="4" height="4"/>',
    );

    expect(receipt.ok).toBe(true);
    expect($('svg').children().get(0)!.namespace).toBe(SVG_NAMESPACE);
  });

  it('rejects detached nodes without producing a partial tree', () => {
    const detached = new Element('div', {});

    const receipt = insertFragment(detached, '<b>x</b>');

    expect(receipt.ok).toBe(false);
    expect(receipt.reason).toBe('detached-target');
    expect(detached.children).toHaveLength(0);
  });

  it('rejects non-element nodes', () => {
    const $ = load('<div>text</div>');

    const receipt = insertFragment($('div').get(0)!.children[0], '<b>x</b>');

    expect(receipt.ok).toBe(false);
    expect(receipt.reason).toBe('not-an-element');
    expect($('div').html()).toBe('text');
  });

  it('accepts options for the fragment parse', () => {
    const $ = load('<div></div>');

    const receipt: FragmentReceipt = insertFragment(
      $('div').get(0)!,
      '<b>x</b>',
      { scriptingEnabled: true },
    );

    // Scripting is forced off for fragment inserts, regardless of options.
    expect(receipt.ok).toBe(true);
    expect($('div').html()).toBe('<b>x</b>');
  });
});
