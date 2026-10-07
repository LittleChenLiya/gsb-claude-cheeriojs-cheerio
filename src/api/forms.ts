import { type AnyNode, type Element, isTag } from 'domhandler';
import type { Cheerio } from '../cheerio.js';
import { text } from '../static.js';

/*
 * https://github.com/jquery/jquery/blob/2.1.3/src/manipulation/var/rcheckableType.js
 * https://github.com/jquery/jquery/blob/2.1.3/src/serialize.js
 */
const submittableSelector = 'input,select,textarea,keygen';
const r20 = /%20/g;
const rCRLF = /\r?\n/g;

/**
 * Options for {@link serialize} and {@link serializeArray}.
 *
 * @category Forms
 */
export interface SerializeOptions {
  /**
   * Compute the submitted value of `<select>` elements that have no `option`
   * with a `selected` attribute, following the HTML form submission algorithm:
   * a single-select submits its first enabled `option`, while a multi-select
   * submits nothing. `option`s that are disabled themselves or that sit inside
   * a disabled `optgroup` are not eligible. The DOM is never modified -- no
   * `selected` attributes are added or removed.
   *
   * When left disabled, `<select>` elements keep the legacy behavior of
   * {@link val}, which only considers `option`s that already carry a
   * `selected` attribute.
   *
   * @default false
   */
  defaultSelectValue?: boolean;
}

/**
 * An `option` is eligible as the default selected option unless it is disabled
 * itself, or it is a child of a disabled `optgroup`.
 *
 * @param option
 * @see {@link https://html.spec.whatwg.org/multipage/form-elements.html#concept-option-disabled}
 */
function isOptionEligible(option: Element): boolean {
  if (Object.hasOwn(option.attribs, 'disabled')) return false;
  const { parent } = option;
  return !(
    parent &&
    isTag(parent) &&
    parent.name === 'optgroup' &&
    Object.hasOwn(parent.attribs, 'disabled')
  );
}

/**
 * The value of an `option`: its `value` attribute, or its text content if the
 * attribute is absent (mirrors the DOM behavior).
 *
 * @param option
 */
function getOptionValue(option: Element): string {
  return Object.hasOwn(option.attribs, 'value')
    ? option.attribs['value']
    : text(option.children);
}

/**
 * Explicitly compute the value a `<select>` element would submit with a form,
 * without modifying the DOM.
 *
 * - `option`s carrying a `selected` attribute determine the value, in document
 *   order.
 * - If no `option` is selected, a single-select falls back to its first
 *   eligible (non-disabled) `option`; `option`s that are disabled or inside a
 *   disabled `optgroup` are skipped. A multi-select submits nothing (`[]`).
 * - If a single-select has no eligible `option` at all, `undefined` is
 *   returned and the control submits nothing.
 *
 * @category Forms
 * @example
 *
 * ```js
 * const $ = cheerio.load(
 *   '<select name="fruit"><option disabled>Apple</option><option>Orange</option></select>',
 * );
 * $('select').selectValue();
 * //=> 'Orange'
 * ```
 *
 * @returns The submitted value: a string for single-selects, an array of
 *   strings for multi-selects, or `undefined` if the control is not a
 *   `<select>` or has nothing to submit.
 * @see {@link https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#constructing-the-form-data-set}
 */
export function selectValue<T extends AnyNode>(
  this: Cheerio<T>,
): string | string[] | undefined {
  const element = this[0];
  if (!(element && isTag(element) && element.name === 'select')) {
    return undefined;
  }

  const options = this.find('option').toArray().filter(isTag);
  const selected = options.filter((option) =>
    Object.hasOwn(option.attribs, 'selected'),
  );

  if (this.attr('multiple') != null) {
    // Multi-selects only submit explicitly selected options.
    return selected.map(getOptionValue);
  }

  if (selected.length > 0) {
    return getOptionValue(selected[0]);
  }

  // Single-select without a selected option: the first eligible option wins.
  const firstEligible = options.find(isOptionEligible);
  return firstEligible ? getOptionValue(firstEligible) : undefined;
}

/**
 * Encode a set of form elements as a string for submission.
 *
 * @category Forms
 * @example
 *
 * ```js
 * $('<form><input name="foo" value="bar" /></form>').serialize();
 * //=> 'foo=bar'
 * ```
 *
 * @param options - Options for the serialization. When omitted, the legacy
 *   behavior is kept.
 * @returns The serialized form.
 * @see {@link https://api.jquery.com/serialize/}
 */
export function serialize<T extends AnyNode>(
  this: Cheerio<T>,
  options?: SerializeOptions,
): string {
  // Convert form elements into name/value objects
  const arr = this.serializeArray(options);

  // Serialize each element into a key/value string
  const retArr = arr.map(
    (data) =>
      `${encodeURIComponent(data.name)}=${encodeURIComponent(data.value)}`,
  );

  // Return the resulting serialization
  return retArr.join('&').replace(r20, '+');
}

/**
 * Encode a set of form elements as an array of names and values.
 *
 * @category Forms
 * @example
 *
 * ```js
 * $('<form><input name="foo" value="bar" /></form>').serializeArray();
 * //=> [ { name: 'foo', value: 'bar' } ]
 * ```
 *
 * @param options - Options for the serialization. Set `defaultSelectValue` to
 *   compute the submitted value of `<select>` elements without a `selected`
 *   option (see {@link selectValue}). When omitted, the legacy behavior is
 *   kept.
 * @returns The serialized form.
 * @see {@link https://api.jquery.com/serializeArray/}
 */
export function serializeArray<T extends AnyNode>(
  this: Cheerio<T>,
  options?: SerializeOptions,
): {
  name: string;
  value: string;
}[] {
  // Resolve all form elements from either forms or collections of form elements
  return this.map((_, elem) => {
    const $elem = this._make(elem);
    if (isTag(elem) && elem.name === 'form') {
      return $elem.find(submittableSelector).toArray();
    }
    return $elem.filter(submittableSelector).toArray();
  })
    .filter(
      // Verify elements have a name (`attr.name`) and are not disabled (`:enabled`)
      '[name!=""]:enabled' +
        // And cannot be clicked (`[type=submit]`) or are used in `x-www-form-urlencoded` (`[type=file]`)
        ':not(:submit, :button, :image, :reset, :file)' +
        // And are either checked/don't have a checkable state
        ':matches([checked], :not(:checkbox, :radio))',
      // Convert each of the elements to its value(s)
    )
    .map<
      AnyNode,
      {
        name: string;
        value: string;
      }
    >((_, elem) => {
      const $elem = this._make(elem);
      const name = $elem.attr('name');
      if (!name) return [];

      let value: string | string[] | undefined;
      if (
        options?.defaultSelectValue &&
        isTag(elem) &&
        elem.name === 'select'
      ) {
        /*
         * Explicitly compute the submitted value of the `<select>`. Controls
         * without a submittable value (e.g. a single-select without any
         * eligible option) are skipped.
         */
        value = $elem.selectValue();
        if (value === undefined) return [];
      } else {
        // If there is no value set (e.g. `undefined`, `null`), then default value to empty
        value = $elem.val() ?? '';
      }

      // If we have an array of values (e.g. `<select multiple>`), return an array of key/value pairs
      if (Array.isArray(value)) {
        return value.map((val) =>
          /*
           * We trim replace any line endings (e.g. `\r` or `\r\n` with `\r\n`) to guarantee consistency across platforms
           * These can occur inside of `<textarea>'s`
           */
          ({ name, value: val.replace(rCRLF, '\r\n') }),
        );
      }
      // Otherwise (e.g. `<input type="text">`, return only one key/value pair
      return { name, value: value.replace(rCRLF, '\r\n') };
    })
    .toArray();
}
