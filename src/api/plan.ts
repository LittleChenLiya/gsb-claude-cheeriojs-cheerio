/**
 * Explicit collection modification plans.
 *
 * A {@link ModificationPlan} describes, up front, which nodes a set of
 * commands should be applied to. Targets are collected from selectors and
 * from explicitly directed nodes, de-duplicated by real node identity and
 * ordered deterministically (document order: ancestors before their
 * descendants) before anything is executed. A command therefore never runs
 * twice on the same node, even if several selectors matched it.
 *
 * Nodes that belong to a different document are handled according to a
 * configurable strategy: the whole plan is either rejected (default, without
 * any partial modification) or the foreign nodes are copied and the commands
 * are applied to the copies.
 *
 * Attribute and text commands are validated for every target before anything
 * is executed; if any command is illegal for any target, the plan fails
 * without touching the DOM. The result attributes every outcome to its
 * source node.
 *
 * The regular Cheerio operation chains are not affected by this module.
 *
 * @module cheerio/plan
 */

import {
  type AnyNode,
  cloneNode,
  type Document,
  type Element,
  hasChildren,
  isTag,
  isText,
  Text,
} from 'domhandler';
import { uniqueSort } from 'domutils';
import type { Cheerio } from '../cheerio.js';
import type { CheerioAPI } from '../load.js';
import { isCheerio } from '../utils.js';

/** How a plan deals with nodes that belong to a different document. */
export type CrossDocumentStrategy =
  /** Reject the whole plan before modifying anything. */
  | 'reject'
  /** Copy the foreign nodes and apply the commands to the copies. */
  | 'clone';

/** Options for a {@link ModificationPlan}. */
export interface ModificationPlanOptions {
  /**
   * Strategy for nodes that belong to a different document than the plan.
   *
   * @default 'reject'
   */
  crossDocument?: CrossDocumentStrategy;
}

/** A single command of a {@link ModificationPlan}. */
export type PlanCommand =
  | { type: 'setAttr'; name: string; value: string }
  | { type: 'removeAttr'; name: string }
  | { type: 'setText'; text: string }
  | { type: 'addClass'; className: string }
  | { type: 'removeClass'; className?: string };

/** Nodes that can be directed at a plan, next to selectors. */
export type PlanNodeInput =
  | AnyNode
  | Cheerio<AnyNode>
  | ArrayLike<AnyNode>
  | PlanNodeInput[];

/** The outcome of a plan for a single source node. */
export interface PlanNodeResult {
  /** The node as it was added to the plan. */
  source: AnyNode;
  /**
   * The node that was actually modified. Identical to `source`, unless the
   * node came from a foreign document and the `clone` strategy was used.
   */
  node: AnyNode;
  /** The commands that were applied to this node, in application order. */
  applied: PlanCommand['type'][];
}

/** The overall outcome of {@link ModificationPlan.apply}. */
export interface PlanResult {
  /**
   * - `applied`: all commands were applied to all targets.
   * - `empty`: the plan had no targets; this is a legal no-op.
   * - `rejected`: foreign nodes were found and the strategy is `reject`.
   * - `invalid`: a command is not legal for at least one target.
   *
   * For `rejected` and `invalid` nothing was modified.
   */
  status: 'applied' | 'empty' | 'rejected' | 'invalid';
  /** Why the plan was not applied, if it wasn't. */
  reason?: string;
  /** One entry per unique source node, in document order. */
  results: PlanNodeResult[];
}

const VALID_ATTRIBUTE_NAME = /^[^\s"'<>/=]+$/u;
const WHITESPACE = /\s/u;
const WHITESPACE_RUN = /\s+/u;

function isValidAttributeName(name: string): boolean {
  return VALID_ATTRIBUTE_NAME.test(name);
}

function isValidClassName(className: string): boolean {
  return className.length > 0 && !WHITESPACE.test(className);
}

/**
 * Find the topmost ancestor of a node.
 *
 * @param node
 */
function getRoot(node: AnyNode): AnyNode {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

/**
 * Flatten node-directed input into a plain node array.
 *
 * @param input
 */
function flattenNodeInput(input: PlanNodeInput): AnyNode[] {
  if (isCheerio<AnyNode>(input)) return input.toArray();
  if (Array.isArray(input)) return input.flatMap(flattenNodeInput);
  if (typeof input === 'object' && input !== null && 'length' in input) {
    const nodes: AnyNode[] = [];
    for (let index = 0; index < input.length; index++) {
      nodes.push(input[index]);
    }
    return nodes;
  }
  return [input];
}

/**
 * Validate a single command against a single target node.
 *
 * @param node
 * @param command
 */
function validateCommand(node: AnyNode, command: PlanCommand): string | null {
  switch (command.type) {
    case 'setAttr':
    case 'removeAttr': {
      if (!isTag(node)) {
        return `${command.type} requires an element, but the target is a ${node.type} node`;
      }
      if (!isValidAttributeName(command.name)) {
        return `Invalid attribute name ${JSON.stringify(command.name)}`;
      }
      return null;
    }
    case 'addClass': {
      if (!isTag(node)) {
        return `addClass requires an element, but the target is a ${node.type} node`;
      }
      if (!isValidClassName(command.className)) {
        return `Invalid class name ${JSON.stringify(command.className)}`;
      }
      return null;
    }
    case 'removeClass': {
      if (!isTag(node)) {
        return `removeClass requires an element, but the target is a ${node.type} node`;
      }
      if (
        command.className !== undefined &&
        !isValidClassName(command.className)
      ) {
        return `Invalid class name ${JSON.stringify(command.className)}`;
      }
      return null;
    }
    case 'setText': {
      if (!(isTag(node) || isText(node))) {
        return `setText requires an element or text node, but the target is a ${node.type} node`;
      }
      return null;
    }
  }
}

function getClassList(element: Element): string[] {
  const classes = element.attribs['class'];
  return classes ? classes.split(WHITESPACE_RUN).filter(Boolean) : [];
}

function applySetAttr(element: Element, name: string, value: string): void {
  element.attribs[name] = value;
}

function applyRemoveAttr(element: Element, name: string): void {
  delete element.attribs[name];
}

function applyAddClass(element: Element, className: string): void {
  const classes = getClassList(element);
  if (!classes.includes(className)) {
    classes.push(className);
    element.attribs['class'] = classes.join(' ');
  }
}

function applyRemoveClass(element: Element, className?: string): void {
  if (className === undefined) {
    applyRemoveAttr(element, 'class');
    return;
  }
  const classes = getClassList(element).filter((cls) => cls !== className);
  if (classes.length === 0) {
    applyRemoveAttr(element, 'class');
  } else {
    element.attribs['class'] = classes.join(' ');
  }
}

/**
 * Check whether the node or one of its descendants is a planned target.
 *
 * @param node
 * @param planned
 */
function containsPlanned(node: AnyNode, planned: Set<AnyNode>): boolean {
  if (planned.has(node)) return true;
  return hasChildren(node)
    ? node.children.some((child) => containsPlanned(child, planned))
    : false;
}

/**
 * Set the text of a node. For elements, all children are replaced by a
 * single text node -- except children that are planned targets themselves
 * (or contain planned targets): those subtrees are kept in place, so
 * associations between selected ancestors and descendants are never lost.
 *
 * @param node
 * @param text
 * @param planned
 */
function applySetText(
  node: AnyNode,
  text: string,
  planned: Set<AnyNode>,
): void {
  if (isText(node)) {
    node.data = text;
    return;
  }
  if (!hasChildren(node)) return;

  const kept = node.children.filter((child) => containsPlanned(child, planned));
  const keptSet = new Set(kept);
  for (const child of node.children) {
    if (keptSet.has(child)) {
      continue;
    }

    child.parent = null;
    child.prev = null;
    child.next = null;
  }

  const textNode = new Text(text);
  const children: AnyNode[] = [textNode, ...kept];
  node.children = children;
  for (const [index, child] of children.entries()) {
    child.parent = node;
    child.prev = children[index - 1] ?? null;
    child.next = children[index + 1] ?? null;
  }
}

/**
 * Apply a single attribute/class command to an element.
 *
 * @param element
 * @param command
 */
function applyStructuralCommand(
  element: Element,
  command: Exclude<PlanCommand, { type: 'setText' }>,
): void {
  switch (command.type) {
    case 'setAttr': {
      applySetAttr(element, command.name, command.value);
      break;
    }
    case 'removeAttr': {
      applyRemoveAttr(element, command.name);
      break;
    }
    case 'addClass': {
      applyAddClass(element, command.className);
      break;
    }
    case 'removeClass': {
      applyRemoveClass(element, command.className);
      break;
    }
  }
}

/**
 * Apply all non-destructive commands of a plan to a node.
 *
 * @param node
 * @param commands
 * @returns The types of the commands that were applied, in order.
 */
function applyStructuralCommands(
  node: AnyNode,
  commands: readonly PlanCommand[],
): PlanCommand['type'][] {
  const applied: PlanCommand['type'][] = [];
  for (const command of commands) {
    if (command.type === 'setText') continue;
    applyStructuralCommand(node as Element, command);
    applied.push(command.type);
  }
  return applied;
}

/**
 * Apply all `setText` commands of a plan to a node.
 *
 * @param node
 * @param commands
 * @param planned
 * @returns The types of the commands that were applied, in order.
 */
function applyTextCommands(
  node: AnyNode,
  commands: readonly PlanCommand[],
  planned: Set<AnyNode>,
): PlanCommand['type'][] {
  const applied: PlanCommand['type'][] = [];
  for (const command of commands) {
    if (command.type !== 'setText') continue;
    applySetText(node, command.text, planned);
    applied.push(command.type);
  }
  return applied;
}

/**
 * Compute the path of child indices from `ancestor` to `node`, or `null` if
 * `ancestor` is not an ancestor of `node`.
 *
 * @param ancestor
 * @param node
 */
function findChildPath(ancestor: AnyNode, node: AnyNode): number[] | null {
  const path: number[] = [];
  let current = node;
  while (current !== ancestor) {
    const { parent } = current;
    if (!(parent && hasChildren(parent))) return null;
    const index = parent.children.indexOf(current);
    if (index === -1) return null;
    path.unshift(index);
    current = parent;
  }
  return path;
}

/**
 * Follow a child-index path down from a (cloned) node.
 *
 * @param root
 * @param path
 */
function followChildPath(root: AnyNode, path: number[]): AnyNode | null {
  let current = root;
  for (const index of path) {
    if (!hasChildren(current)) return null;
    const next: AnyNode | undefined = current.children[index];
    if (!next) return null;
    current = next;
  }
  return current;
}

/**
 * Find the counterpart of a foreign node inside the clone of an already
 * cloned ancestor, so that ancestor/descendant associations are kept intact
 * under the `clone` strategy.
 *
 * @param source
 * @param cloneMap
 * @returns The counterpart node, or `null` if no ancestor was cloned yet.
 */
function findCloneCounterpart(
  source: AnyNode,
  cloneMap: Map<AnyNode, AnyNode>,
): AnyNode | null {
  let ancestor = source.parent;
  while (ancestor) {
    const clonedAncestor = cloneMap.get(ancestor);
    if (clonedAncestor) {
      const path = findChildPath(ancestor, source);
      return path ? followChildPath(clonedAncestor, path) : null;
    }
    ancestor = ancestor.parent;
  }
  return null;
}

/**
 * An explicit modification plan over a de-duplicated, deterministically
 * ordered set of nodes.
 *
 * Targets are gathered with {@link ModificationPlan.select} (selectors) and
 * {@link ModificationPlan.nodes} (node-directed commands). Commands are added
 * with `setAttr`, `removeAttr`, `setText`, `addClass` and `removeClass`, and
 * are executed by {@link ModificationPlan.apply}.
 *
 * @example A plan over four nodes: the ancestor `#fruits` and its three
 * descendant `li` elements. `.apple` matches a node that `li` already
 * matched; it is still only modified once. The ancestor is processed before
 * its descendants, and the parent/child associations are kept intact.
 *
 * ```html
 * <ul id="fruits">
 *   <li class="apple">Apple</li>
 *   <li class="orange">Orange</li>
 *   <li class="pear">Pear</li>
 * </ul>
 * ```
 *
 * ```js
 * const result = createPlan($)
 *   .select('#fruits', 'li', '.apple')
 *   .setAttr('data-planned', 'yes')
 *   .addClass('planned')
 *   .apply();
 *
 * result.status; // 'applied'
 * result.results.length; // 4 — one entry per unique node
 * ```
 */
export class ModificationPlan {
  readonly #api: CheerioAPI;
  readonly #document: Document;
  readonly #options: ModificationPlanOptions;
  readonly #selectors: string[] = [];
  readonly #directedNodes: AnyNode[] = [];
  readonly #commands: PlanCommand[] = [];

  /**
   * @param $
   * @param options
   * @internal
   */
  constructor($: CheerioAPI, options: ModificationPlanOptions = {}) {
    this.#api = $;
    this.#document = $._root;
    this.#options = options;
  }

  /**
   * Add the nodes matched by the given selectors to the plan. Matches are
   * de-duplicated against all other targets by real node identity.
   *
   * @param selectors - The selectors to match targets with.
   * @returns The plan, for chaining.
   */
  select(...selectors: string[]): this {
    this.#selectors.push(...selectors);
    return this;
  }

  /**
   * Direct the plan at explicit nodes (node-directed commands). Accepts
   * domhandler nodes, Cheerio selections and arrays of either.
   *
   * @param nodes - The nodes to add to the plan.
   * @returns The plan, for chaining.
   */
  nodes(...nodes: PlanNodeInput[]): this {
    for (const input of nodes) {
      this.#directedNodes.push(...flattenNodeInput(input));
    }
    return this;
  }

  /**
   * Add a raw command to the plan.
   *
   * @param command
   * @returns The plan, for chaining.
   */
  command(command: PlanCommand): this {
    this.#commands.push(command);
    return this;
  }

  /**
   * Set an attribute on every target.
   *
   * @param name
   * @param value
   * @returns The plan, for chaining.
   */
  setAttr(name: string, value: string): this {
    return this.command({ type: 'setAttr', name, value });
  }

  /**
   * Remove an attribute from every target.
   *
   * @param name
   * @returns The plan, for chaining.
   */
  removeAttr(name: string): this {
    return this.command({ type: 'removeAttr', name });
  }

  /**
   * Set the text of every target.
   *
   * @param text
   * @returns The plan, for chaining.
   */
  setText(text: string): this {
    return this.command({ type: 'setText', text });
  }

  /**
   * Add a class to every target.
   *
   * @param className
   * @returns The plan, for chaining.
   */
  addClass(className: string): this {
    return this.command({ type: 'addClass', className });
  }

  /**
   * Remove a class from every target. Without a class name, all classes are
   * removed.
   *
   * @param className
   * @returns The plan, for chaining.
   */
  removeClass(className?: string): this {
    return this.command({ type: 'removeClass', className });
  }

  /**
   * The unique target nodes of this plan, in document order (ancestors
   * before their descendants). Nodes matched by several selectors, or added
   * both by a selector and directly, appear exactly once.
   */
  get targets(): AnyNode[] {
    const matched: AnyNode[] = [];
    for (const selector of this.#selectors) {
      matched.push(...this.#api(selector).toArray());
    }
    matched.push(...this.#directedNodes);
    return uniqueSort(matched);
  }

  /** The commands of this plan, in the order they were added. */
  get commands(): readonly PlanCommand[] {
    return this.#commands;
  }

  /**
   * Execute the plan.
   *
   * The plan is first checked as a whole: foreign nodes are rejected (or
   * copied, depending on the `crossDocument` strategy) and every command is
   * validated against every target. Only if everything checks out is
   * anything modified -- a failed plan never partially modifies the DOM.
   *
   * Commands are applied in document order (ancestors before descendants);
   * `setText` commands are applied in a second pass, descendants first, and
   * preserve planned descendant subtrees.
   *
   * @returns The outcome, with one result entry per unique source node.
   */
  apply(): PlanResult {
    const { targets } = this;

    if (targets.length === 0) {
      // An empty collection is a legal empty plan.
      return { status: 'empty', results: [] };
    }

    const strategy = this.#options.crossDocument ?? 'reject';
    const isForeign = (node: AnyNode): boolean =>
      getRoot(node) !== this.#document;
    const foreign = targets.filter(isForeign);

    if (foreign.length > 0 && strategy === 'reject') {
      return {
        status: 'rejected',
        reason: `Plan contains ${foreign.length} node(s) from a different document; rejecting the whole plan without modifying anything`,
        results: [],
      };
    }

    /*
     * Determine the effective node for every source node. Foreign nodes are
     * cloned; descendants of cloned ancestors map to their counterpart
     * inside the ancestor's clone, keeping ancestor/descendant associations
     * intact.
     */
    const items = targets.map((source) => ({ source, node: source }));
    if (foreign.length > 0) {
      const cloneMap = new Map<AnyNode, AnyNode>();
      for (const item of items) {
        if (!isForeign(item.source)) continue;
        const mapped =
          findCloneCounterpart(item.source, cloneMap) ??
          cloneNode(item.source, true);
        cloneMap.set(item.source, mapped);
        item.node = mapped;
      }
    }

    // Validate every command against every target before touching the DOM.
    for (const item of items) {
      for (const command of this.#commands) {
        const problem = validateCommand(item.node, command);
        if (problem) {
          return {
            status: 'invalid',
            reason: problem,
            results: [],
          };
        }
      }
    }

    /*
     * Everything checks out; apply. Non-destructive commands run in document
     * order (ancestors first), `setText` runs in a second pass, descendants
     * first, so planned subtrees are updated before their ancestors and no
     * association is lost.
     */
    const planned = new Set(items.map((item) => item.node));
    const applied: PlanCommand['type'][][] = items.map(() => []);

    for (const [index, item] of items.entries()) {
      applied[index].push(
        ...applyStructuralCommands(item.node, this.#commands),
      );
    }

    for (let index = items.length - 1; index >= 0; index--) {
      applied[index].push(
        ...applyTextCommands(items[index].node, this.#commands, planned),
      );
    }

    return {
      status: 'applied',
      results: items.map((item, index) => ({
        source: item.source,
        node: item.node,
        applied: applied[index],
      })),
    };
  }
}

/**
 * Create an explicit modification plan for the document of the given
 * Cheerio API instance.
 *
 * @example Four nodes, directed explicitly instead of by selector:
 *
 * ```js
 * const plan = createPlan($).nodes(
 *   $('#fruits')[0],
 *   $('li').toArray(), // three more nodes
 * );
 * plan.setAttr('data-seen', '1');
 * plan.apply().results.length; // 4
 * ```
 *
 * @param $ - The Cheerio API instance whose document the plan operates on.
 * @param options - Options, e.g. the cross-document strategy.
 * @returns The new plan.
 */
export function createPlan(
  $: CheerioAPI,
  options?: ModificationPlanOptions,
): ModificationPlan {
  return new ModificationPlan($, options);
}
