/**
 * Explicit, validated set-modification plans.
 *
 * A {@link ModificationPlan} captures a set of source nodes (deduped by real
 * node identity and ordered so that ancestors precede descendants) and a
 * sequence of operations. Every operation is validated against every target
 * before anything is written back to the DOM, so a rejected plan never leaves
 * a partially modified document.
 *
 * @module cheerio/plan
 */

import {
  type AnyNode,
  cloneNode,
  type Document,
  hasChildren,
  isTag,
  type ParentNode,
  Text,
} from 'domhandler';
import type { Cheerio } from '../cheerio.js';
import type { CheerioAPI } from '../load.js';
import type { BasicAcceptedElems } from '../types.js';
import { isCheerio } from '../utils.js';

/**
 * Policy used when a source node belongs to a different document than the one
 * the plan was created against.
 *
 * - `reject` (the default): the whole plan is rejected before any modification.
 * - `copy`: a deep clone of the foreign node is operated on instead.
 */
export type CrossDocumentPolicy = 'reject' | 'copy';

/** Options accepted by {@link ModificationPlan}. */
export interface PlanOptions {
  /** How to handle nodes that belong to another document. Defaults to `reject`. */
  crossDocument?: CrossDocumentPolicy;
}

/** A single source-node result. */
export interface PlanSuccess {
  ok: true;
  /** The source node the result refers to. */
  node: AnyNode;
}

/** A single source-node failure. */
export interface PlanFailure {
  ok: false;
  /** The source node the result refers to. */
  node: AnyNode;
  /** Why the node could not be modified. */
  error: Error;
}

/** The result of a plan for a single source node. */
export type PlanNodeResult = PlanSuccess | PlanFailure;

/** The outcome of committing a {@link ModificationPlan}. */
export interface PlanResult {
  /** Whether every source node was modified successfully. */
  ok: boolean;
  /** Per-source-node results, in plan order. */
  results: PlanNodeResult[];
}

/** A node (or collection of nodes) that an operation can be directed at. */
export type PlanTarget = AnyNode | AnyNode[] | Cheerio<AnyNode>;

type PlanOperation =
  | { op: 'attr'; name: string; value: string | null; target?: PlanTarget }
  | {
      op: 'attrs';
      values: Record<string, string | null>;
      target?: PlanTarget;
    }
  | { op: 'removeAttr'; names: string[]; target?: PlanTarget }
  | { op: 'addClass'; names: string[]; target?: PlanTarget }
  | { op: 'removeClass'; names: string[]; target?: PlanTarget }
  | {
      op: 'toggleClass';
      names: string[];
      state?: boolean;
      target?: PlanTarget;
    }
  | { op: 'text'; value: string; target?: PlanTarget }
  | { op: 'html'; value: string; target?: PlanTarget }
  | { op: 'empty'; target?: PlanTarget }
  | { op: 'remove'; target?: PlanTarget };

const rspace = /\s+/;

/**
 * Walk up the `parent` chain to the topmost node. For an attached node this is
 * the owning {@link Document}; for a detached node it is the node itself.
 *
 * @param node - The node to find the root of.
 * @returns The topmost ancestor.
 */
function getRoot(node: AnyNode): AnyNode {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

/**
 * Build a pre-order index of every node reachable from `root`. Used to order
 * source nodes so that ancestors always precede their descendants.
 *
 * @param root - The root to traverse.
 * @returns A map from node to its pre-order index.
 */
function buildOrderIndex(root: AnyNode): Map<AnyNode, number> {
  const order = new Map<AnyNode, number>();
  let index = 0;

  const walk = (node: AnyNode): void => {
    if (order.has(node)) return;
    order.set(node, index++);
    if (hasChildren(node)) {
      for (const child of node.children) walk(child);
    }
  };

  walk(root);
  return order;
}

/**
 * Flatten a flexible node argument into a plain array of nodes. Selector
 * strings are resolved using the supplied resolver.
 *
 * @param resolver - Resolves a selector string into nodes.
 * @param nodes - A cheerio instance, selector string, node, or array of any of
 *   those.
 * @returns The resolved nodes.
 */
function resolveNodes(
  resolver: (selector: string) => AnyNode[],
  nodes:
    | BasicAcceptedElems<AnyNode>
    | PlanTarget
    | PlanTarget[]
    | null
    | undefined,
): AnyNode[] {
  if (nodes == null) return [];

  const result: AnyNode[] = [];
  const stack: unknown[] = Array.isArray(nodes) ? [...nodes] : [nodes];

  while (stack.length > 0) {
    const item = stack.pop();

    if (item == null) continue;

    if (isCheerio(item)) {
      for (let i = 0; i < item.length; i++) result.push(item[i] as AnyNode);
    } else if (typeof item === 'string') {
      for (const node of resolver(item)) result.push(node);
    } else if (typeof item === 'object' && 'length' in item) {
      const arr = item as ArrayLike<AnyNode>;
      for (let i = 0; i < arr.length; i++) stack.push(arr[i]);
    } else if (typeof item === 'object') {
      result.push(item as AnyNode);
    }
  }

  return result;
}

/**
 * Resolve an operation's target into the working nodes it applies to.
 *
 * @param target - The target to resolve.
 * @param workingNodes - Map from source node to the node actually operated on.
 * @returns The working nodes the operation applies to.
 */
function resolveTarget(
  target: PlanTarget,
  workingNodes: Map<AnyNode, AnyNode>,
): AnyNode[] {
  const result: AnyNode[] = [];
  const seen = new Set<AnyNode>();

  for (const node of resolveNodes(
    // Targets are always node-based; selectors are not expected here.
    () => {
      throw new Error('Unexpected selector target');
    },
    target,
  )) {
    const working = workingNodes.get(node);
    if (working && !seen.has(working)) {
      seen.add(working);
      result.push(working);
    }
  }

  return result;
}

/**
 * Validate that an operation can legally be applied to a target node.
 *
 * @param op - The operation to validate.
 * @param target - The node the operation would be applied to.
 * @returns An error describing the illegality, or `undefined` if legal.
 */
function validateOp(op: PlanOperation, target: AnyNode): Error | undefined {
  switch (op.op) {
    case 'attr':
    case 'attrs':
    case 'removeAttr':
    case 'addClass':
    case 'removeClass':
    case 'toggleClass': {
      if (!isTag(target)) {
        return new Error(
          `Cannot apply "${op.op}" to a non-element node (type ${target.type}).`,
        );
      }
      return undefined;
    }
    case 'text':
    case 'html': {
      if (!isTag(target)) {
        return new Error(
          `Cannot set ${op.op} on a non-element node (type ${target.type}).`,
        );
      }
      return undefined;
    }
    case 'empty': {
      if (!hasChildren(target)) {
        return new Error(
          `Cannot empty a node without children (type ${target.type}).`,
        );
      }
      return undefined;
    }
    case 'remove': {
      return undefined;
    }
  }
}

/**
 * Apply a validated operation to a target node.
 *
 * @param op - The operation to apply.
 * @param target - The node to apply the operation to.
 * @param parse - Parses an HTML string into a document.
 */
function applyOp(
  op: PlanOperation,
  target: AnyNode,
  parse: (value: string, context: ParentNode) => AnyNode[],
): void {
  switch (op.op) {
    case 'attr': {
      if (!isTag(target)) return;
      if (op.value === null) delete target.attribs[op.name];
      else target.attribs[op.name] = `${op.value}`;
      return;
    }
    case 'attrs': {
      if (!isTag(target)) return;
      for (const [name, value] of Object.entries(op.values)) {
        if (value === null) delete target.attribs[name];
        else target.attribs[name] = `${value}`;
      }
      return;
    }
    case 'removeAttr': {
      if (!isTag(target)) return;
      for (const name of op.names) delete target.attribs[name];
      return;
    }
    case 'addClass': {
      if (!isTag(target)) return;
      const existing = target.attribs['class'] ?? '';
      const classes = new Set(existing.split(rspace).filter(Boolean));
      for (const name of op.names) classes.add(name);
      target.attribs['class'] = [...classes].join(' ');
      return;
    }
    case 'removeClass': {
      if (!isTag(target)) return;
      const existing = target.attribs['class'] ?? '';
      const classes = new Set(existing.split(rspace).filter(Boolean));
      for (const name of op.names) classes.delete(name);
      target.attribs['class'] = [...classes].join(' ');
      return;
    }
    case 'toggleClass': {
      if (!isTag(target)) return;
      const existing = target.attribs['class'] ?? '';
      const classes = new Set(existing.split(rspace).filter(Boolean));
      for (const name of op.names) {
        if (op.state === true) classes.add(name);
        else if (op.state === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      }
      target.attribs['class'] = [...classes].join(' ');
      return;
    }
    case 'text': {
      if (!hasChildren(target)) return;
      clearChildren(target);
      const text = new Text(op.value);
      text.parent = target;
      target.children = [text as never];
      return;
    }
    case 'html': {
      if (!hasChildren(target)) return;
      clearChildren(target);
      const children = parse(op.value, target);
      for (const child of children) {
        child.parent = target;
      }
      target.children = children as never;
      return;
    }
    case 'empty': {
      if (!hasChildren(target)) return;
      clearChildren(target);
      return;
    }
    case 'remove': {
      const { parent } = target;
      if (parent) {
        const siblings = parent.children;
        const index = siblings.indexOf(target as never);
        if (index !== -1) siblings.splice(index, 1);
      }
      target.parent = target.prev = target.next = null;
      return;
    }
  }
}

/**
 * Detach every child of a node and clear its children array.
 *
 * @param node - The node whose children to clear.
 */
function clearChildren(node: ParentNode): void {
  for (const child of node.children) {
    child.next = child.prev = child.parent = null;
  }
  node.children = [];
}

/**
 * An explicit, validated set-modification plan.
 *
 * Create a plan with {@link plan}, chain operations onto it, and call
 * {@link ModificationPlan.commit} to apply them atomically.
 *
 * @example
 *
 * ```js
 * const $ = cheerio.load('<div><span class="a"></span><span class="b"></span></div>');
 * const result = $.plan($('span'))
 *   .addClass('highlight')
 *   .attr('data-done', 'true')
 *   .commit();
 *
 * result.ok;
 * //=> true
 * ```
 */
export class ModificationPlan {
  /** The source nodes the plan was created with, deduped and ordered. */
  readonly nodes: AnyNode[];

  private readonly $: CheerioAPI;
  private readonly root: Document;
  private readonly crossDocument: CrossDocumentPolicy;
  private readonly operations: PlanOperation[] = [];
  private pendingTarget: PlanTarget | undefined;

  /**
   * @internal Use {@link plan} to create a plan.
   * @param $ - The bound cheerio instance.
   * @param nodes - The source nodes to modify.
   * @param options - Plan options.
   */
  constructor(
    $: CheerioAPI,
    nodes:
      | BasicAcceptedElems<AnyNode>
      | PlanTarget
      | PlanTarget[]
      | null
      | undefined,
    options: PlanOptions = {},
  ) {
    this.$ = $;
    this.root = $._root;
    this.crossDocument = options.crossDocument ?? 'reject';

    const resolved = resolveNodes((selector) => $(selector).toArray(), nodes);

    // Deduplicate by real node identity.
    const seen = new Set<AnyNode>();
    const deduped: AnyNode[] = [];
    for (const node of resolved) {
      if (node && typeof node === 'object' && !seen.has(node)) {
        seen.add(node);
        deduped.push(node);
      }
    }

    // Order ancestors before descendants for a clear, deterministic order.
    const order = buildOrderIndex(this.root);
    deduped.sort((a, b) => {
      const ai = order.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });

    this.nodes = deduped;
  }

  /**
   * Direct the next operation at a specific node (or nodes) instead of every
   * node in the plan.
   *
   * @example
   *
   * ```js
   * const span = $('span').first();
   * $.plan($('span')).at(span).addClass('only-first').commit();
   * ```
   *
   * @param target - The node(s) to direct the next operation at.
   * @returns The plan, for chaining.
   */
  at(target: PlanTarget): this {
    this.pendingTarget = target;
    return this;
  }

  private consumeTarget(): PlanTarget | undefined {
    const target = this.pendingTarget;
    this.pendingTarget = undefined;
    return target;
  }

  /**
   * Set an attribute on the plan's nodes.
   *
   * @param name - The attribute name.
   * @param value - The value, or `null` to remove the attribute.
   * @returns The plan, for chaining.
   */
  attr(name: string, value: string | null): this;
  /**
   * Set multiple attributes on the plan's nodes.
   *
   * @param values - A map of attribute names to values.
   * @returns The plan, for chaining.
   */
  attr(values: Record<string, string | null>): this;
  attr(
    name: string | Record<string, string | null>,
    value?: string | null,
  ): this {
    if (typeof name === 'object') {
      this.operations.push({
        op: 'attrs',
        values: name,
        target: this.consumeTarget(),
      });
    } else {
      this.operations.push({
        op: 'attr',
        name,
        value: value ?? null,
        target: this.consumeTarget(),
      });
    }
    return this;
  }

  /**
   * Remove one or more attributes from the plan's nodes.
   *
   * @param names - A space-separated list of attribute names.
   * @returns The plan, for chaining.
   */
  removeAttr(names: string): this {
    this.operations.push({
      op: 'removeAttr',
      names: names.split(rspace).filter(Boolean),
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Add class(es) to the plan's nodes.
   *
   * @param names - A space-separated list of class names.
   * @returns The plan, for chaining.
   */
  addClass(names: string): this {
    this.operations.push({
      op: 'addClass',
      names: names.split(rspace).filter(Boolean),
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Remove class(es) from the plan's nodes.
   *
   * @param names - A space-separated list of class names.
   * @returns The plan, for chaining.
   */
  removeClass(names: string): this {
    this.operations.push({
      op: 'removeClass',
      names: names.split(rspace).filter(Boolean),
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Toggle class(es) on the plan's nodes.
   *
   * @param names - A space-separated list of class names.
   * @param state - Optional boolean to force adding (`true`) or removing
   *   (`false`).
   * @returns The plan, for chaining.
   */
  toggleClass(names: string, state?: boolean): this {
    this.operations.push({
      op: 'toggleClass',
      names: names.split(rspace).filter(Boolean),
      state,
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Replace the text content of the plan's nodes.
   *
   * @param value - The text to set.
   * @returns The plan, for chaining.
   */
  text(value: string): this {
    this.operations.push({
      op: 'text',
      value,
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Replace the inner HTML of the plan's nodes.
   *
   * @param value - The HTML to set.
   * @returns The plan, for chaining.
   */
  html(value: string): this {
    this.operations.push({
      op: 'html',
      value,
      target: this.consumeTarget(),
    });
    return this;
  }

  /**
   * Remove all children from the plan's nodes.
   *
   * @returns The plan, for chaining.
   */
  empty(): this {
    this.operations.push({ op: 'empty', target: this.consumeTarget() });
    return this;
  }

  /**
   * Remove the plan's nodes from the document.
   *
   * @returns The plan, for chaining.
   */
  remove(): this {
    this.operations.push({ op: 'remove', target: this.consumeTarget() });
    return this;
  }

  /**
   * Validate every operation against every target, without modifying the DOM.
   *
   * @returns The working nodes and any failures.
   */
  private validate(): {
    workingNodes: Map<AnyNode, AnyNode>;
    failures: PlanNodeResult[];
  } {
    const workingNodes = new Map<AnyNode, AnyNode>();
    const failures: PlanNodeResult[] = [];

    // Resolve cross-document nodes first, so validation operates on the nodes
    // that will actually be modified.
    for (const source of this.nodes) {
      if (getRoot(source) === this.root) {
        workingNodes.set(source, source);
      } else if (this.crossDocument === 'reject') {
        failures.push({
          ok: false,
          node: source,
          error: new Error(
            'Node belongs to a different document; cross-document policy is "reject".',
          ),
        });
      } else {
        const clone = cloneNode(source, true);
        clone.parent = this.root;
        workingNodes.set(source, clone);
      }
    }

    if (failures.length > 0) return { workingNodes, failures };

    // Validate each operation against its resolved targets.
    for (const operation of this.operations) {
      const targets = operation.target
        ? resolveTarget(operation.target, workingNodes)
        : [...workingNodes.values()];

      for (const target of targets) {
        const error = validateOp(operation, target);
        if (error) {
          const source = [...workingNodes.entries()].find(
            ([, working]) => working === target,
          )?.[0];
          failures.push({
            ok: false,
            node: source ?? target,
            error,
          });
        }
      }
    }

    return { workingNodes, failures };
  }

  /**
   * Apply the plan atomically.
   *
   * All operations are validated before anything is written. If any operation
   * is illegal for any target, or a cross-document node is rejected, the
   * document is left untouched and every source node is reported as failed.
   *
   * @returns The per-source-node result of the plan.
   */
  commit(): PlanResult {
    const { workingNodes, failures } = this.validate();

    if (failures.length > 0) {
      // Attribute the failure to every source node so callers can tell the plan
      // was rejected without partial modification.
      const results: PlanNodeResult[] = this.nodes.map((node) => {
        const failure = failures.find((f) => f.node === node);
        return (
          failure ?? {
            ok: false,
            node,
            error: new Error('Plan rejected; no modifications were made.'),
          }
        );
      });

      return { ok: false, results };
    }

    // Apply operations in the order they were added.
    const parse = (value: string, _context: ParentNode): AnyNode[] =>
      this.$(value).toArray();

    for (const operation of this.operations) {
      const targets = operation.target
        ? resolveTarget(operation.target, workingNodes)
        : [...workingNodes.values()];

      for (const target of targets) applyOp(operation, target, parse);
    }

    const results: PlanNodeResult[] = this.nodes.map((node) => ({
      ok: true,
      node,
    }));

    return { ok: true, results };
  }
}

/**
 * Create an explicit, validated set-modification plan.
 *
 * The plan captures `nodes` at creation time, deduplicates them by real node
 * identity, and orders them so that ancestors precede descendants. Operations
 * are validated before being applied, so a rejected plan never modifies the
 * DOM.
 *
 * @category Static
 * @example
 *
 * ```js
 * const $ = cheerio.load('<div><span></span></div>');
 * const result = $.plan($('span')).attr('id', 'x').commit();
 * ```
 *
 * @param nodes - The source nodes to modify.
 * @param options - Plan options.
 * @returns A new {@link ModificationPlan}.
 */
export function plan(
  this: CheerioAPI,
  nodes:
    | BasicAcceptedElems<AnyNode>
    | PlanTarget
    | PlanTarget[]
    | null
    | undefined,
  options?: PlanOptions,
): ModificationPlan {
  return new ModificationPlan(this, nodes, options);
}
