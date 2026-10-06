/**
 * @file Explicit context fragment insertion.
 *
 * The primitives in this module parse an HTML fragment with the *real* parse
 * context of the target node (the way `innerHTML` works in browsers), instead
 * of parsing the markup without any context and appending the result. This
 * makes a difference for targets such as `table` sections, `select` elements
 * and SVG subtrees, where the parser applies context-specific rules.
 *
 * Parsing never executes scripts and never simulates browser events; the
 * fragment is parsed with scripting explicitly disabled.
 *
 * @module cheerio/fragment
 */

import {
  type AnyNode,
  type Document,
  Element,
  hasChildren,
  isDocument,
  isTag,
  type ParentNode,
} from 'domhandler';
import { removeElement } from 'domutils';
import type { InternalOptions } from './options.js';

/**
 * The parser signature used to parse fragments.
 *
 * Matches the shape of `Cheerio._parse`.
 */
export type FragmentParser = (
  content: string,
  options: InternalOptions,
  isDocument: boolean,
  context: ParentNode | null,
) => Document;

/** Reasons why a fragment insertion can be rejected. */
export type FragmentRejectionReason =
  /** The target is not an element node. */
  | 'not-an-element'
  /** The target is a void HTML element, which cannot have children. */
  | 'void-element'
  /** The target is not part of a document. */
  | 'detached-target'
  /** The target belongs to a different document than the Cheerio instance. */
  | 'foreign-document'
  /** The configured parser does not support context fragment parsing. */
  | 'parser-mismatch';

/**
 * A node whose final position was corrected by the parser.
 *
 * HTML parsing sometimes relocates nodes, for example when a `<td>` is parsed
 * in the context of a `<table>` and the parser implies intermediate `<tbody>`
 * and `<tr>` elements. The correction receipt records where such a node
 * actually ended up.
 */
export interface FragmentCorrection {
  /** The node that ended up in a corrected position. */
  node: AnyNode;
  /** The parent the node actually ended up in. */
  parent: ParentNode;
  /** The index of the node within `parent.children`. */
  index: number;
  /**
   * Names of the parser-implied ancestor elements the node was moved into,
   * outermost first.
   */
  via: string[];
}

/** A receipt describing the outcome of a fragment insertion. */
export interface FragmentReceipt {
  /** Whether the fragment was parsed in context and inserted. */
  ok: boolean;
  /** The reason the insertion was rejected, if it was. */
  reason?: FragmentRejectionReason;
  /** The target node of the insertion. */
  target: AnyNode;
  /** The top-level nodes that were inserted into the target, in order. */
  inserted: AnyNode[];
  /**
   * Receipts for nodes whose position was corrected by the parser, including
   * the final position of each node.
   */
  corrections: FragmentCorrection[];
}

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** HTML elements that cannot have children. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Check whether a node is a legal target for a context fragment insertion.
 *
 * This verifies the ownership of the node (it has to be part of a document,
 * and of the document of the Cheerio instance if `ownerDocument` is passed)
 * and the legality of inserting children into it.
 *
 * @param target - The node to check.
 * @param options - The options of the current instance.
 * @param ownerDocument - The document the target has to belong to, if any.
 * @returns The rejection reason, or `null` if the target is legal.
 */
export function getFragmentRejection(
  target: AnyNode,
  options: InternalOptions,
  ownerDocument?: Document | null,
): FragmentRejectionReason | null {
  if (!isTag(target)) {
    return 'not-an-element';
  }

  if (
    (target.namespace == null || target.namespace === HTML_NAMESPACE) &&
    VOID_ELEMENTS.has(target.name.toLowerCase())
  ) {
    return 'void-element';
  }

  let root: AnyNode = target;
  while (root.parent) {
    root = root.parent;
  }

  if (!isDocument(root)) {
    return 'detached-target';
  }

  if (ownerDocument != null && root !== ownerDocument) {
    return 'foreign-document';
  }

  if (options._useHtmlParser2) {
    return 'parser-mismatch';
  }

  return null;
}

const parserSupportCache = new WeakMap<FragmentParser, boolean>();

/**
 * Check whether a parser actually honors the fragment context.
 *
 * Some entry points (for example the `slim` build) use parsers without
 * support for context fragments; probing once per parser lets us reject the
 * insertion instead of silently parsing without context.
 *
 * @param parse - The parser to probe.
 * @param options - The options to parse with.
 * @returns Whether the parser supports context fragments.
 */
function supportsContextFragments(
  parse: FragmentParser,
  options: InternalOptions,
): boolean {
  let supported = parserSupportCache.get(parse);

  if (supported === undefined) {
    /*
     * A `<td>` parsed in a `<table>` context gets implied `<tbody>` and
     * `<tr>` ancestors; parsers without context support return a bare `<td>`.
     */
    const context = new Element('table', {});
    context.namespace = HTML_NAMESPACE;
    const probe = parse('<td></td>', { ...options }, false, context);
    const [first] = probe.children;
    supported = isTag(first) && first.name === 'tbody';
    parserSupportCache.set(parse, supported);
  }

  return supported;
}

/**
 * Append nodes to a parent, updating all sibling and parent references.
 *
 * @param parent - The parent to append to.
 * @param nodes - The nodes to append.
 */
function appendChildren(parent: ParentNode, nodes: AnyNode[]): void {
  const { children } = parent;
  let prev: AnyNode | null =
    children.length > 0 ? children[children.length - 1] : null;

  for (const node of nodes) {
    if (node.parent) {
      removeElement(node);
    }

    node.parent = parent;
    node.prev = prev;
    node.next = null;

    if (prev) {
      prev.next = node;
    }

    children.push(node);
    prev = node;
  }
}

type NodeWithLocation = AnyNode & { sourceCodeLocation?: unknown };

/**
 * Collect receipts for nodes whose position was corrected by the parser.
 *
 * Nodes that are present in the source markup carry a source code location,
 * while elements implied by the parser (such as a `<tbody>` around a `<tr>`)
 * do not. Any source node that ends up below a parser-implied element was
 * relocated, and its final position is reported.
 *
 * @param inserted - The top-level inserted nodes.
 * @returns The correction receipts.
 */
function collectCorrections(inserted: AnyNode[]): FragmentCorrection[] {
  const corrections: FragmentCorrection[] = [];

  const visit = (node: AnyNode, impliedAncestors: string[]): void => {
    const isImplied =
      isTag(node) && (node as NodeWithLocation).sourceCodeLocation == null;
    const via = isImplied ? [...impliedAncestors, node.name] : impliedAncestors;

    if (!isImplied && via.length > 0 && node.parent) {
      corrections.push({
        node,
        parent: node.parent,
        index: node.parent.children.indexOf(node),
        via,
      });
    }

    if (hasChildren(node)) {
      for (const child of node.children) {
        visit(child, via);
      }
    }
  };

  for (const node of inserted) {
    visit(node, []);
  }

  return corrections;
}

/**
 * Parse `html` with the real parse context of `target` and insert the result
 * as the last children of `target`.
 *
 * The ownership of the target and the legality of the insertion are checked
 * before anything is parsed; if the target is rejected, it is left untouched
 * and no partial tree is produced. HTML and SVG namespaces are preserved by
 * the context-aware parse. Scripts are never executed and no browser events
 * are simulated.
 *
 * @param parse - The parser to use, for example `Cheerio._parse`.
 * @param target - The node to insert the fragment into.
 * @param html - The markup to parse in the context of `target`.
 * @param options - The options to parse with.
 * @param ownerDocument - The document the target has to belong to, if any.
 * @returns A receipt describing the outcome.
 */
export function insertFragmentWithParser(
  parse: FragmentParser,
  target: AnyNode,
  html: string,
  options: InternalOptions,
  ownerDocument?: Document | null,
): FragmentReceipt {
  const reason =
    getFragmentRejection(target, options, ownerDocument) ??
    (supportsContextFragments(parse, options)
      ? null
      : ('parser-mismatch' as const));

  if (reason !== null) {
    return { ok: false, reason, target, inserted: [], corrections: [] };
  }

  /*
   * Parse with the real context of the target. Scripting is explicitly
   * disabled; scripts are never executed and no events are simulated.
   */
  const fragment = parse(
    html,
    { ...options, scriptingEnabled: false, sourceCodeLocationInfo: true },
    false,
    target as Element,
  );

  const inserted = [...fragment.children];
  appendChildren(target as Element, inserted);

  return {
    ok: true,
    target,
    inserted,
    corrections: collectCorrections(inserted),
  };
}
