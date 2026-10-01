/**
 * Perf timer — lightweight span-based timing for latency profiling (P0-1 latency work).
 *
 * Enabled via PERF_TRACE=1. When disabled every call is a no-op with ~zero
 * overhead, so the instrumentation can stay in production code paths.
 *
 * Usage:
 *   const end = perfSpan('retrieveContext');   // or: await perfMeasure('x', () => fn())
 *   ...
 *   end();
 *   perfCount('llm_call');                      // count provider calls
 *
 *   // at the end of a turn:
 *   perfReport('processMessageV2');
 */
import logger from '../utils/logger';

const ENABLED = process.env.PERF_TRACE === '1';

interface SpanNode {
  name: string;
  startMs: number;
  totalMs: number;
  selfMs: number;
  calls: number;
  children: Map<string, SpanNode>;
}

interface ActiveSpan {
  node: SpanNode;
  childMs: number;
}

const roots = new Map<string, SpanNode>();
const stack: ActiveSpan[] = [];
const counters = new Map<string, number>();

function getOrCreateNode(parent: Map<string, SpanNode>, name: string): SpanNode {
  let node = parent.get(name);
  if (!node) {
    node = { name, startMs: 0, totalMs: 0, selfMs: 0, calls: 0, children: new Map() };
    parent.set(name, node);
  }
  return node;
}

/** Start a named span; call the returned function to end it. No-op when disabled. */
export function perfSpan(name: string): () => void {
  if (!ENABLED) return () => undefined;
  const parentMap = stack.length > 0 ? stack[stack.length - 1].node.children : roots;
  const node = getOrCreateNode(parentMap, name);
  node.calls += 1;
  const active: ActiveSpan = { node, childMs: 0 };
  node.startMs = Date.now();
  stack.push(active);
  return () => {
    const elapsed = Date.now() - node.startMs;
    node.totalMs += elapsed;
    node.selfMs += Math.max(0, elapsed - active.childMs);
    stack.pop();
    if (stack.length > 0) {
      stack[stack.length - 1].childMs += elapsed;
    }
  };
}

/** Measure an async (or sync) function under a named span. */
export async function perfMeasure<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  if (!ENABLED) return fn();
  const end = perfSpan(name);
  try {
    return await fn();
  } finally {
    end();
  }
}

/** Increment a named counter (e.g. 'llm_call', 'embedding_call', 'db_vector_query'). */
export function perfCount(name: string, by = 1): void {
  if (!ENABLED) return;
  counters.set(name, (counters.get(name) ?? 0) + by);
}

/** Reset all collected spans and counters (use between benchmark iterations). */
export function perfReset(): void {
  roots.clear();
  stack.length = 0;
  counters.clear();
}

function renderNode(node: SpanNode, depth: number, out: string[]): void {
  const indent = '  '.repeat(depth);
  const avg = node.calls > 0 ? node.totalMs / node.calls : 0;
  out.push(
    `${indent}${node.name}: total=${node.totalMs.toFixed(0)}ms self=${node.selfMs.toFixed(0)}ms calls=${node.calls} avg=${avg.toFixed(0)}ms`,
  );
  const kids = [...node.children.values()].sort((a, b) => b.totalMs - a.totalMs);
  for (const kid of kids) renderNode(kid, depth + 1, out);
}

/** Log the collected timing tree + counters under the given label. No-op when disabled. */
export function perfReport(label: string): void {
  if (!ENABLED) return;
  const out: string[] = [`[perf] ${label} timing (ms):`];
  const sorted = [...roots.values()].sort((a, b) => b.totalMs - a.totalMs);
  for (const r of sorted) renderNode(r, 1, out);
  if (counters.size > 0) {
    out.push(`[perf] ${label} counters:`);
    for (const [k, v] of [...counters.entries()].sort()) out.push(`  ${k}: ${v}`);
  }
  logger.info(out.join('\n'));
}

/** Snapshot of counters for assertions in tests. */
export function perfGetCounters(): Record<string, number> {
  return Object.fromEntries(counters.entries());
}

/** True when PERF_TRACE=1. */
export function perfEnabled(): boolean {
  return ENABLED;
}
