import renderWithHtmlparser2 from 'dom-serializer';
import type { AnyNode } from 'domhandler';
import { parseDocument as parseWithHtmlparser2 } from 'htmlparser2';
import { type FragmentReceipt, insertFragmentWithParser } from './fragment.js';
import { type CheerioAPI, getLoad } from './load.js';
import { type CheerioOptions, flattenOptions } from './options.js';
import { getParse } from './parse.js';
import { parseWithParse5, renderWithParse5 } from './parsers/parse5-adapter.js';

const parse = getParse((content, options, isDocument, context) =>
  options._useHtmlParser2
    ? parseWithHtmlparser2(content, options)
    : parseWithParse5(content, options, isDocument, context),
);

// Duplicate docs due to https://github.com/TypeStrong/typedoc/issues/1616
/**
 * Create a querying function, bound to a document created from the provided
 * markup.
 *
 * Note that similar to web browser contexts, this operation may introduce
 * `<html>`, `<head>`, and `<body>` elements; set `isDocument` to `false` to
 * switch to fragment mode and disable this.
 *
 * @category Loading
 * @param content - Markup to be loaded.
 * @param options - Options for the created instance.
 * @param isDocument - Allows parser to be switched to fragment mode.
 * @returns The loaded document.
 * @see {@link https://cheerio.js.org/docs/basics/loading#load} for additional usage information.
 */
export const load: (
  content: string | AnyNode | AnyNode[] | Buffer,
  options?: CheerioOptions | null,
  isDocument?: boolean,
) => CheerioAPI = getLoad(parse, (dom, options) =>
  options._useHtmlParser2
    ? renderWithHtmlparser2(dom, options)
    : renderWithParse5(dom),
);

/**
 * Insert an HTML fragment into a node, parsing the markup with the _real
 * parse context_ of the target node (the way `innerHTML` works in browsers).
 *
 * This is the Node-directed form of `Cheerio.appendFragment`: it takes a
 * single DOM node directly instead of a selection. The ownership of the
 * target and the legality of the insertion are checked before anything is
 * parsed; a rejected target is left untouched and no partial tree is
 * produced. HTML and SVG namespaces are preserved. Scripts are never executed
 * and no browser events are simulated.
 *
 * @category Manipulation
 * @example A `<tbody>` target produces a real row:
 *
 * ```js
 * const $ = cheerio.load('<table><tbody></tbody></table>');
 * const receipt = cheerio.insertFragment(
 *   $('tbody').get(0),
 *   '<tr><td>Apple</td></tr>',
 * );
 * receipt.ok; //=> true
 * $('tbody').html(); //=> '<tr><td>Apple</td></tr>'
 * ```
 *
 * @example A `<select>` target accepts options:
 *
 * ```js
 * const $ = cheerio.load('<select></select>');
 * cheerio.insertFragment($('select').get(0), '<option>One</option>');
 * $('select').html(); //=> '<option>One</option>'
 * ```
 *
 * @example An SVG target keeps its namespace:
 *
 * ```js
 * const $ = cheerio.load('<svg viewBox="0 0 10 10"></svg>');
 * cheerio.insertFragment($('svg').get(0), '<circle cx="5" cy="5" r="4"/>');
 * $('svg circle').get(0).namespace; //=> 'http://www.w3.org/2000/svg'
 * ```
 *
 * @param target - The node to insert the fragment into.
 * @param html - The markup to parse in the context of `target`.
 * @param options - Options for the parser.
 * @returns A receipt describing the outcome of the insertion.
 */
export function insertFragment(
  target: AnyNode,
  html: string,
  options?: CheerioOptions | null,
): FragmentReceipt {
  return insertFragmentWithParser(parse, target, html, flattenOptions(options));
}
