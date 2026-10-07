import { type AnyNode, type Element, isTag } from 'domhandler';
import { findAll, textContent } from 'domutils';
import type { Cheerio } from '../cheerio.js';

/*
 * https://github.com/jquery/jquery/blob/2.1.3/src/manipulation/var/rcheckableType.js
 * https://github.com/jquery/jquery/blob/2.1.3/src/serialize.js
 */
const submittableSelector = 'input,select,textarea,keygen';
const r20 = /%20/g;
const rCRLF = /\r?\n/g;

/**
 * Options controlling how form values are computed during serialization.
 *
 * @category Forms
 */
export interface SerializeOptions {
  /**
   * Compute the submitted value of `<select>` elements explicitly, following
   * HTML form semantics: a single-select without a `selected` option submits
   * its first eligible option, a multi-select without a `selected` option
   * submits nothing, and options that are disabled (or inside a disabled
   * `optgroup`) are not eligible. The DOM is left untouched.
   *
   * When not enabled, the legacy jQuery-compatible behavior of `val()` is
   * used instead.
   *
   * @default false
   */
  selectDefaults?: boolean;
}

/**
 * Check whether an `<option>` is eligible for submission: it must not be
 * `disabled` itself, and none of its ancestor `<optgroup>` elements (up to
 * the containing `<select>`) may be `disabled`.
 *
 * @param option - The option element to check.
 * @returns Whether the option can be submitted.
 */
function isEligibleOption(option: Element): boolean {
  if (option.attribs['disabled'] != null) return false;
  let node = option.parent;
  while (node && isTag(node) && node.name !== 'select') {
    if (node.name === 'optgroup' && node.attribs['disabled'] != null) {
      return false;
    }
    node = node.parent;
  }
  return true;
}

/**
 * Get the submission value of an `<option>`: its `value` attribute if
 * present, otherwise its text content.
 *
 * @param option - The option element.
 * @returns The option's submission value.
 */
function getOptionValue(option: Element): string {
  return Object.hasOwn(option.attribs, 'value')
    ? option.attribs['value']
    : textContent(option);
}

/**
 * Compute the submitted value of a `<select>` element, without modifying the
 * DOM (no `selected` attributes are added or removed).
 *
 * @param select - The select element.
 * @returns The value(s) the select would submit: a single value for
 * single-selects, an array of values for multi-selects, or `undefined` if a
 * single-select has no eligible option at all.
 */
function computeSelectValue(select: Element): string | string[] | undefined {
  const options = findAll(
    (elem) => elem.name === 'option',
    select.children,
  ).filter(isEligibleOption);

  if (select.attribs['multiple'] != null) {
    // Multi-select: submit every selected, eligible option (possibly none).
    return options
      .filter((option) => option.attribs['selected'] != null)
      .map(getOptionValue);
  }

  /*
   * Single-select: the first selected, eligible option wins; if none is
   * selected, the first eligible option is submitted.
   */
  const chosen =
    options.find((option) => option.attribs['selected'] != null) ?? options[0];
  return chosen ? getOptionValue(chosen) : undefined;
}

/**
 * Method for getting the value a `<select>` element would submit as part of a
 * form, following HTML form semantics. Unlike `val()`, this computes default
 * selections explicitly: a single-select without a `selected` option submits
 * its first eligible option, while a multi-select without a `selected` option
 * submits nothing. Options that are `disabled` or inside a disabled
 * `optgroup` are not eligible. The DOM is never modified.
 *
 * @category Forms
 * @example
 *
 * ```js
 * const $ = cheerio.load(
 *   '<select><option value="a">A</option><option value="b">B</option></select>',
 * );
 * $('select').selectValue();
 * //=> 'a'
 * ```
 *
 * @returns The submitted value: a string for single-selects, an array of
 * strings for multi-selects, or `undefined` if the first element is not a
 * `<select>` or has no eligible option.
 */
export function selectValue<T extends AnyNode>(
  this: Cheerio<T>,
): string | string[] | undefined {
  const element = this[0];
  if (!(element && isTag(element) && element.name === 'select')) {
    return undefined;
  }
  return computeSelectValue(element);
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
 * @param options - Options controlling how form values are computed. When
 * omitted, the legacy jQuery-compatible behavior is used.
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
 * @param options - Options controlling how form values are computed. When
 * omitted, the legacy jQuery-compatible behavior is used.
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
      /*
       * If requested, compute the submitted value of `<select>` elements
       * explicitly (HTML form semantics). Otherwise, fall back to the legacy
       * `val()` behavior. If there is no value set (e.g. `undefined`,
       * `null`), then default value to empty.
       */
      const value =
        (options?.selectDefaults && isTag(elem) && elem.name === 'select'
          ? computeSelectValue(elem)
          : $elem.val()) ?? '';

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
