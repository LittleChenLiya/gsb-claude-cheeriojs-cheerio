/**
 * Explicit context-aware fragment insertion.
 *
 * Unlike the classic manipulation methods, which parse markup without any
 * context and then attach the resulting nodes, the functions in this module
 * parse fragments with the real parse context of the target node. This makes
 * inserting rows into tables, options into selects, and nodes into SVG
 * subtrees behave the way the HTML parser would in a browser -- without
 * executing scripts or simulating browser events.
 *
 * @module cheerio/fragment
 */

import {
  type AnyNode,
  type Document,
  type Element,
  hasChildren,
  isDocument,
  isTag,
  type ParentNode,
} from 'domhandler';
import {
  type CheerioOptions,
  flattenOptions,
  type InternalOptions,
} from './options.js';
import { getParse } from './parse.js';
import { parseWithParse5 } from './parsers/parse5-adapter.js';

/**
 * A receipt for a fragment insertion.
 *
 * The parser may correct the placement of nodes, for example by wrapping them
 * in implied elements or by moving text. The receipt reports where the nodes
 * actually landed, so callers can inspect the corrected position.
 */
export interface FragmentReceipt {
  /** The element the fragment nodes were appended to. */
  target: Element;
  /** The index within `target.children` at which the first node was inserted. */
  index: number;
  /** The inserted nodes, in document order. */
  nodes: AnyNode[];
}

/**
 * The parser signature used for fragment parsing.
 *
 * Matches the private `_parse` method of `Cheerio` instances.
 */
export type FragmentParser = (
  content: string,
  options: InternalOptions,
  isDocument: boolean,
  context: ParentNode | null,
) => Document;

const parseWithDefaultParser: FragmentParser = getParse(parseWithParse5);

/**
 * Find the document a node belongs to by walking up the parent chain.
 *
 * @param node - The node to find the owner document for.
 * @returns The owning document, or `null` for detached nodes.
 */
function getOwnerDocument(node: AnyNode): Document | null {
  let current = node;
  while (current.parent) {
    current = current.parent;
  }
  return isDocument(current) ? current : null;
}

/**
 * Collect the lowercased tag names of all elements in a node tree.
 *
 * @param nodes - The nodes to collect tag names from.
 * @param tagNames - The set to add tag names to.
 * @returns The set of tag names.
 */
function collectTagNames(
  nodes: AnyNode[],
  tagNames: Set<string> = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (isTag(node)) {
      tagNames.add(node.tagName.toLowerCase());
    }
    if (hasChildren(node)) {
      collectTagNames(node.children, tagNames);
    }
  }
  return tagNames;
}

/**
 * Parse `fragment` with `target` as the parse context and append the
 * resulting nodes to `target`.
 *
 * The target is checked before anything is modified:
 *
 * - Node ownership: the target must be an element that belongs to a document.
 *   If `owner` is given, it must be that document.
 * - Insertion validity: every element of the fragment must survive parsing in
 *   the target's context. If the context parser drops any element of the
 *   fragment, the target is not a legal context for the fragment.
 *
 * If either check fails, the target is left untouched and `null` is returned;
 * no partial tree is ever inserted.
 *
 * Fragments are parsed with `scriptingEnabled` disabled: scripts are never
 * executed and no browser events are simulated. HTML and SVG namespaces are
 * preserved by the context parser.
 *
 * @param parse - The parser to use.
 * @param target - The node to append the fragment to.
 * @param fragment - The markup to parse and insert.
 * @param options - Options for the parser.
 * @param owner - Optional document the target must belong to.
 * @returns A receipt describing where the nodes landed, or `null` if the
 *   insertion was rejected.
 */
export function insertFragmentWithParser(
  parse: FragmentParser,
  target: AnyNode,
  fragment: string,
  options: InternalOptions,
  owner?: AnyNode | null,
): FragmentReceipt | null {
  // Only elements can receive child nodes.
  if (!isTag(target)) {
    return null;
  }

  // Node ownership: the target must belong to a document.
  const document = getOwnerDocument(target);
  if (!document || (owner != null && document !== owner)) {
    return null;
  }

  /*
   * Parse the fragment with the target element as the real parse context.
   * Scripts are never executed and no browser events are simulated.
   */
  const fragmentOptions: InternalOptions = {
    ...options,
    scriptingEnabled: false,
  };
  const nodes = [...parse(fragment, fragmentOptions, false, target).children];

  /*
   * Insertion validity: parse the fragment again without a context and make
   * sure every element of the fragment survives the target context. If the
   * context parser dropped any element, the target is not a legal context
   * for this fragment; leave the target untouched.
   */
  const baseline = parse(fragment, fragmentOptions, false, null).children;
  const surviving = collectTagNames(nodes);
  for (const tagName of collectTagNames(baseline)) {
    if (!surviving.has(tagName)) {
      return null;
    }
  }

  // Append the nodes and report where they landed.
  const index = target.children.length;
  let previous: AnyNode | null =
    index === 0 ? null : target.children[index - 1];
  for (const node of nodes) {
    node.parent = target;
    node.prev = previous;
    node.next = null;
    if (previous) {
      previous.next = node;
    }
    target.children.push(node);
    previous = node;
  }

  return { target, index, nodes };
}

/**
 * Insert a fragment into a specific node, using the node itself as the parse
 * context.
 *
 * This is the node-directed counterpart of the `appendFragment` method; it
 * works directly on a node of a parsed document. The node must belong to a
 * document, and every element of the fragment must survive the node's parse
 * context; otherwise the node is left untouched and `null` is returned.
 *
 * @example Three targets: table, select and SVG.
 *
 * ```js
 * const $ = cheerio.load(
 *   '<table><tbody></tbody></table><select></select><svg></svg>',
 * );
 *
 * // Table: `<tr>` becomes a real row of the tbody.
 * insertFragment($('tbody')[0], '<tr><td>Apple</td></tr>');
 *
 * // Select: `<option>` is inserted as an option of the select.
 * insertFragment($('select')[0], '<option value="1">One</option>');
 *
 * // SVG: the circle keeps the SVG namespace.
 * insertFragment($('svg')[0], '<circle r="1"/>');
 * ```
 *
 * @param target - The node to append the fragment to.
 * @param fragment - The markup to parse and insert.
 * @param options - Options for the parser.
 * @returns A receipt describing where the nodes landed, or `null` if the
 *   insertion was rejected.
 */
export function insertFragment(
  target: AnyNode,
  fragment: string,
  options?: CheerioOptions | null,
): FragmentReceipt | null {
  return insertFragmentWithParser(
    parseWithDefaultParser,
    target,
    fragment,
    flattenOptions(options),
  );
}
