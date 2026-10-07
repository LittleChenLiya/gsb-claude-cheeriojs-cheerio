import { beforeEach, describe, expect, it } from 'vitest';
import { cheerio, forms } from '../__fixtures__/fixtures.js';
import { type CheerioAPI, load } from '../index.js';

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
  });

  describe('select submission values', () => {
    /*
     * In-memory fixture: two single-selects (one with a disabled first
     * option, one with a disabled optgroup) and one multi-select without any
     * selected option.
     */
    const selectForm = [
      '<form id="select-defaults">',
      '<select name="fruit">',
      '<option value="Apple" disabled>Apple</option>',
      '<option value="Orange">Orange</option>',
      '<option value="Pear">Pear</option>',
      '</select>',
      '<select name="veg">',
      '<optgroup label="root" disabled>',
      '<option value="Carrot">Carrot</option>',
      '</optgroup>',
      '<optgroup label="leaf">',
      '<option value="Leek">Leek</option>',
      '<option value="Kale" selected>Kale</option>',
      '</optgroup>',
      '</select>',
      '<select name="topping" multiple>',
      '<option value="Cheese">Cheese</option>',
      '<option value="Bacon" disabled>Bacon</option>',
      '</select>',
      '</form>',
      '<form id="same-name">',
      '<select name="pick"><option value="one">1</option></select>',
      '<select name="pick">',
      '<option value="two" selected>2</option>',
      '<option value="three">3</option>',
      '</select>',
      '</form>',
    ].join('');

    let $defaults: CheerioAPI;

    beforeEach(() => {
      $defaults = load(selectForm);
    });

    describe('.selectValue', () => {
      it('() : should pick the first eligible option when nothing is selected', () => {
        // First option is disabled, so the second option wins.
        expect($defaults('select[name=fruit]').selectValue()).toBe('Orange');
      });

      it('() : should skip options in a disabled optgroup', () => {
        expect($defaults('select[name=veg]').selectValue()).toBe('Kale');
      });

      it('() : should return an empty array for multi-selects without selection', () => {
        expect($defaults('select[name=topping]').selectValue()).toStrictEqual(
          [],
        );
      });

      it('() : should return selected values for multi-selects', () => {
        const $multi = load(
          '<select multiple>' +
            '<option value="a" selected>A</option>' +
            '<option value="b">B</option>' +
            '<option value="c" selected disabled>C</option>' +
            '</select>',
        );
        expect($multi('select').selectValue()).toStrictEqual(['a']);
      });

      it('() : should fall back to option text when no value attribute exists', () => {
        const $text = load('<select><option>Hello</option></select>');
        expect($text('select').selectValue()).toBe('Hello');
      });

      it('() : should return undefined for non-select elements', () => {
        expect($defaults('form').selectValue()).toBeUndefined();
      });

      it('() : should not modify selected attributes in the DOM', () => {
        for (const el of $defaults('select').toArray()) {
          $defaults(el).selectValue();
        }
        // Only the originally selected option keeps its attribute.
        expect($defaults('#select-defaults option[selected]')).toHaveLength(1);
        expect(
          $defaults('#select-defaults option[selected]').attr('value'),
        ).toBe('Kale');
        expect(
          $defaults('select[name=fruit] option').first().attr('selected'),
        ).toBeUndefined();
      });
    });

    describe('.serializeArray({ selectDefaults: true })', () => {
      it('should compute default select submission values', () => {
        expect(
          $defaults('form#select-defaults').serializeArray({
            selectDefaults: true,
          }),
        ).toStrictEqual([
          { name: 'fruit', value: 'Orange' },
          { name: 'veg', value: 'Kale' },
        ]);
      });

      it('should keep document order for same-name selects', () => {
        expect(
          $defaults('form#same-name').serializeArray({
            selectDefaults: true,
          }),
        ).toStrictEqual([
          { name: 'pick', value: 'one' },
          { name: 'pick', value: 'two' },
        ]);
      });

      it('should not modify selected attributes in the DOM', () => {
        $defaults('form#select-defaults').serializeArray({
          selectDefaults: true,
        });
        expect($defaults('#select-defaults option[selected]')).toHaveLength(1);
        expect(
          $defaults('#select-defaults option[selected]').attr('value'),
        ).toBe('Kale');
      });

      it('should keep the legacy behavior when the option is not enabled', () => {
        /*
         * Legacy `val()` relies on the `:selected` pseudo-class, which falls
         * back to the first option of a single-select (even a disabled one)
         * and does not handle optgroups.
         */
        expect(
          $defaults('form#select-defaults').serializeArray(),
        ).toStrictEqual([
          { name: 'fruit', value: 'Apple' },
          { name: 'veg', value: 'Kale' },
        ]);
      });
    });

    describe('.serialize({ selectDefaults: true })', () => {
      it('should forward the options to serializeArray', () => {
        expect(
          $defaults('form#select-defaults').serialize({
            selectDefaults: true,
          }),
        ).toBe('fruit=Orange&veg=Kale');
        expect($defaults('form#select-defaults').serialize()).toBe(
          'fruit=Apple&veg=Kale',
        );
      });
    });
  });
});
