import { beforeEach, describe, expect, it } from 'vitest';
import { cheerio, forms } from '../__fixtures__/fixtures.js';
import type { CheerioAPI } from '../index.js';

describe('$(...)', () => {
  let $: CheerioAPI;

  beforeEach(() => {
    $ = cheerio.load(forms);
  });

  describe('.serializeArray', () => {
    it('() : should get form controls', () => {
      expect($('form#simple').serializeArray()).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
      ]);
    });

    it('() : should get nested form controls', () => {
      expect($('form#nested').serializeArray()).toHaveLength(2);
      const data = $('form#nested').serializeArray();
      data.sort((a, b) => a.value.localeCompare(b.value));
      expect(data).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
        {
          name: 'vegetable',
          value: 'Carrot',
        },
      ]);
    });

    it('() : should not get disabled form controls', () => {
      expect($('form#disabled').serializeArray()).toStrictEqual([]);
    });

    it('() : should not get form controls with the wrong type', () => {
      expect($('form#submit').serializeArray()).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
      ]);
    });

    it('() : should get selected options', () => {
      expect($('form#select').serializeArray()).toStrictEqual([
        {
          name: 'fruit',
          value: 'Orange',
        },
      ]);
    });

    it('() : should not get unnamed form controls', () => {
      expect($('form#unnamed').serializeArray()).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
      ]);
    });

    it('() : should get multiple selected options', () => {
      expect($('form#multiple').serializeArray()).toHaveLength(2);
      const data = $('form#multiple').serializeArray();
      data.sort((a, b) => a.value.localeCompare(b.value));
      expect(data).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
        {
          name: 'fruit',
          value: 'Orange',
        },
      ]);
    });

    it('() : should get individually selected elements', () => {
      const data = $('form#nested input').serializeArray();
      data.sort((a, b) => a.value.localeCompare(b.value));
      expect(data).toStrictEqual([
        {
          name: 'fruit',
          value: 'Apple',
        },
        {
          name: 'vegetable',
          value: 'Carrot',
        },
      ]);
    });

    it('() : should standardize line breaks', () => {
      expect($('form#textarea').serializeArray()).toStrictEqual([
        {
          name: 'fruits',
          value: 'Apple\r\nOrange',
        },
      ]);
    });

    it("() : shouldn't serialize the empty string", () => {
      expect($('<input value=pineapple>').serializeArray()).toStrictEqual([]);
      expect(
        $('<input name="" value=pineapple>').serializeArray(),
      ).toStrictEqual([]);
      expect(
        $('<input name="fruit" value=pineapple>').serializeArray(),
      ).toStrictEqual([
        {
          name: 'fruit',
          value: 'pineapple',
        },
      ]);
    });

    it('() : should serialize inputs without value attributes', () => {
      expect($('<input name="fruit">').serializeArray()).toStrictEqual([
        {
          name: 'fruit',
          value: '',
        },
      ]);
    });

    describe('select default submission values', () => {
      /*
       * Two single-selects (sharing a name, to verify document order) and one
       * multi-select, with a disabled first option and a disabled optgroup.
       */
      const defaultSelects = [
        '<form id="default-selects">',
        '<select name="pick">',
        '<option value="Apple" disabled>Apple</option>',
        '<option value="Orange">Orange</option>',
        '<option value="Pear">Pear</option>',
        '</select>',
        '<select name="pick">',
        '<optgroup label="veg" disabled><option value="Carrot">Carrot</option></optgroup>',
        '<optgroup label="legume"><option value="Bean">Bean</option></optgroup>',
        '</select>',
        '<select name="multi" multiple>',
        '<option value="A">A</option>',
        '<option value="B" disabled>B</option>',
        '</select>',
        '</form>',
      ].join('');

      it('() : should compute submitted values without modifying the DOM', () => {
        const $defaults = cheerio.load(defaultSelects);
        const before = $defaults.html();

        expect(
          $defaults('form#default-selects').serializeArray(),
        ).toStrictEqual([
          /*
           * Legacy behavior: the first direct-child option is picked even
           * when disabled, and options inside `optgroup`s are not found.
           */
          { name: 'pick', value: 'Apple' },
          { name: 'pick', value: '' },
        ]);

        expect(
          $defaults('form#default-selects').serializeArray({
            defaultSelectValue: true,
          }),
        ).toStrictEqual([
          // First enabled option, skipping the disabled first option
          { name: 'pick', value: 'Orange' },
          // First option outside the disabled optgroup; same-name order preserved
          { name: 'pick', value: 'Bean' },
          // The multi-select without selected options submits nothing
        ]);

        // No `selected` attributes were added or removed
        expect($defaults('option[selected]')).toHaveLength(0);
        expect($defaults.html()).toBe(before);
      });

      it('() : should keep explicitly selected options with defaultSelectValue', () => {
        expect(
          $('form#select').serializeArray({ defaultSelectValue: true }),
        ).toStrictEqual([{ name: 'fruit', value: 'Orange' }]);
        expect(
          $('form#multiple').serializeArray({ defaultSelectValue: true }),
        ).toStrictEqual([
          { name: 'fruit', value: 'Apple' },
          { name: 'fruit', value: 'Orange' },
        ]);
      });

      it('() : should skip single-selects without any eligible option', () => {
        expect(
          $(
            '<select name="none"><option value="x" disabled>x</option></select>',
          ).serializeArray({ defaultSelectValue: true }),
        ).toStrictEqual([]);
      });
    });
  });

  describe('.serialize', () => {
    it('() : should get form controls', () => {
      expect($('form#simple').serialize()).toBe('fruit=Apple');
    });

    it('() : should get nested form controls', () => {
      expect($('form#nested').serialize()).toBe('fruit=Apple&vegetable=Carrot');
    });

    it('() : should not get disabled form controls', () => {
      expect($('form#disabled').serialize()).toBe('');
    });

    it('() : should get multiple selected options', () => {
      expect($('form#multiple').serialize()).toBe('fruit=Apple&fruit=Orange');
    });

    it("() : should encode spaces as +'s", () => {
      expect($('form#spaces').serialize()).toBe('fruit=Blood+orange');
    });

    it('(options) : should compute default select submission values', () => {
      const $defaults = cheerio.load(
        '<form><select name="a"><option disabled>x</option><option>y</option></select>' +
          '<select name="b" multiple><option>1</option></select></form>',
      );
      // Legacy behavior without the option: the disabled option is picked
      expect($defaults('form').serialize()).toBe('a=x');
      expect($defaults('form').serialize({ defaultSelectValue: true })).toBe(
        'a=y',
      );
    });
  });

  describe('.selectValue', () => {
    it('() : should return undefined for non-select elements', () => {
      expect($('input').selectValue()).toBeUndefined();
    });

    it('() : should fall back to the first enabled option for single-selects', () => {
      const $defaults = cheerio.load(
        '<select><option value="a" disabled>a</option><option value="b">b</option></select>',
      );
      expect($defaults('select').selectValue()).toBe('b');
    });

    it('() : should skip options inside a disabled optgroup', () => {
      const $defaults = cheerio.load(
        '<select><optgroup disabled><option value="a">a</option></optgroup><option value="b">b</option></select>',
      );
      expect($defaults('select').selectValue()).toBe('b');
    });

    it('() : should use the option text when no value attribute is present', () => {
      const $defaults = cheerio.load('<select><option>Apple</option></select>');
      expect($defaults('select').selectValue()).toBe('Apple');
    });

    it('() : should return an empty array for multi-selects without selected options', () => {
      const $defaults = cheerio.load(
        '<select multiple><option value="a">a</option></select>',
      );
      expect($defaults('select').selectValue()).toStrictEqual([]);
    });

    it('() : should return selected option values in document order', () => {
      const $defaults = cheerio.load(
        '<select multiple><option value="a" selected>a</option><option value="b">b</option><option value="c" selected>c</option></select>',
      );
      expect($defaults('select').selectValue()).toStrictEqual(['a', 'c']);
      expect(
        cheerio
          .load(
            '<select><option value="a">a</option><option value="b" selected>b</option></select>',
          )('select')
          .selectValue(),
      ).toBe('b');
    });

    it('() : should return undefined when no option is eligible', () => {
      const $defaults = cheerio.load(
        '<select><option disabled>a</option></select><select></select>',
      );
      expect($defaults('select').first().selectValue()).toBeUndefined();
      expect($defaults('select').last().selectValue()).toBeUndefined();
    });

    it('() : should not modify selected attributes', () => {
      const $defaults = cheerio.load(
        '<select><option disabled>a</option><option>b</option></select>',
      );
      $defaults('select').selectValue();
      expect($defaults('option[selected]')).toHaveLength(0);
      expect($defaults('select').html()).toBe(
        '<option disabled="">a</option><option>b</option>',
      );
    });
  });
});
