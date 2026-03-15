/**
 * Tracy Flame Graph Builder
 *
 * Reconstructs a zone call tree from tracy-csvexport -u (per-call) output.
 * Outputs either a text flame tree or folded stacks (for flamegraph.pl / speedscope).
 *
 * Algorithm:
 *   Per thread, sort calls by ns_since_start.
 *   Maintain a stack of open zones.  When a new call begins, pop zones whose
 *   end-time <= call start (they have already closed).  The top of the stack is
 *   the parent.  Build a tree keyed by the full call path.
 */

export interface FlameNode {
  name: string;
  file?: string;
  line?: number;
  /** inclusive time: self + all descendants (nanoseconds, summed over all calls) */
  inclusiveNs: number;
  /** exclusive time: only this zone, not children (nanoseconds) */
  exclusiveNs: number;
  /** number of times this node appeared at this position in the call tree */
  count: number;
  children: Map<string, FlameNode>;
}

export interface FlameGraph {
  /** one synthetic root whose children are the top-level zones */
  root: FlameNode;
  /** total wall-clock span captured (ns) */
  totalNs: number;
  /** thread → root-level children for per-thread breakdown */
  threads: Map<string, FlameNode>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface Call {
  name: string;
  file?: string;
  line?: number;
  startNs: number;
  endNs: number;
  thread: string;
}

interface StackFrame {
  name: string;
  endNs: number;
  /** path from the root, e.g. ["frame", "particle_update"] */
  path: string[];
}

function makeNode(name: string, file?: string, line?: number): FlameNode {
  return { name, file, line, inclusiveNs: 0, exclusiveNs: 0, count: 0, children: new Map() };
}

function getOrCreate(parent: FlameNode, name: string, file?: string, line?: number): FlameNode {
  if (!parent.children.has(name)) {
    parent.children.set(name, makeNode(name, file, line));
  }
  return parent.children.get(name)!;
}

// ── Main builder ──────────────────────────────────────────────────────────────

export function buildFlameGraph(unwrapCsv: string): FlameGraph {
  // Parse per-call CSV: name,src_file,src_line,ns_since_start,exec_time_ns,thread[,value]
  const calls: Call[] = [];
  const lines = unwrapCsv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) continue;
    const startNs = parseInt(parts[3], 10);
    const execNs  = parseInt(parts[4], 10);
    if (isNaN(startNs) || isNaN(execNs) || execNs <= 0) continue;
    calls.push({
      name:    parts[0],
      file:    parts[1] || undefined,
      line:    parts[2] ? parseInt(parts[2], 10) : undefined,
      startNs,
      endNs:   startNs + execNs,
      thread:  parts[5] || '0',
    });
  }

  // Group by thread
  const byThread = new Map<string, Call[]>();
  for (const c of calls) {
    if (!byThread.has(c.thread)) byThread.set(c.thread, []);
    byThread.get(c.thread)!.push(c);
  }

  const globalRoot = makeNode('<root>');
  const threadNodes = new Map<string, FlameNode>();
  let totalNs = 0;

  for (const [threadId, threadCalls] of byThread) {
    // Sort by start time
    threadCalls.sort((a, b) => a.startNs - b.startNs);

    const threadRoot = makeNode(`thread:${threadId}`);
    threadNodes.set(threadId, threadRoot);

    const stack: StackFrame[] = [];

    for (const call of threadCalls) {
      // Pop frames that ended before this call started
      while (stack.length > 0 && stack[stack.length - 1].endNs <= call.startNs) {
        stack.pop();
      }

      // Build path
      const path = stack.length > 0
        ? [...stack[stack.length - 1].path, call.name]
        : [call.name];

      // Walk the tree and update nodes
      let node = globalRoot;
      for (const seg of path) {
        node = getOrCreate(node, seg);
      }
      node.count++;
      node.inclusiveNs += call.endNs - call.startNs;
      node.file  ??= call.file;
      node.line  ??= call.line;

      // Same walk in the per-thread tree
      let tnode = threadRoot;
      for (const seg of path) {
        tnode = getOrCreate(tnode, seg);
      }
      tnode.count++;
      tnode.inclusiveNs += call.endNs - call.startNs;
      tnode.file  ??= call.file;
      tnode.line  ??= call.line;

      // Push this frame
      stack.push({ name: call.name, endNs: call.endNs, path });

      if (call.endNs > totalNs) totalNs = call.endNs;
    }
  }

  // Compute exclusive time: exclusive = inclusive - sum(children.inclusive)
  computeExclusive(globalRoot);
  for (const tr of threadNodes.values()) computeExclusive(tr);

  return { root: globalRoot, totalNs, threads: threadNodes };
}

function computeExclusive(node: FlameNode): void {
  let childrenInclusive = 0;
  for (const child of node.children.values()) {
    computeExclusive(child);
    childrenInclusive += child.inclusiveNs;
  }
  node.exclusiveNs = Math.max(0, node.inclusiveNs - childrenInclusive);
}

// ── Text output ───────────────────────────────────────────────────────────────

function ns(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}ms`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}µs`;
  return `${n}ns`;
}

/**
 * Render the flame graph as an indented text tree, sorted by inclusive time
 * descending.  Only nodes whose inclusive time exceeds `minPercent`% of the
 * root are shown.
 */
export function formatFlameGraph(
  fg: FlameGraph,
  options: { minPercent?: number; maxDepth?: number } = {}
): string {
  const { minPercent = 1.0, maxDepth = 8 } = options;

  // Compute the reference total = sum of top-level inclusive times
  let refNs = 0;
  for (const child of fg.root.children.values()) {
    refNs += child.inclusiveNs;
  }
  if (refNs === 0) return 'No zone data found.';

  const minNs = refNs * minPercent / 100;

  const lines: string[] = [];
  lines.push(`Flame Graph  (total captured: ${ns(refNs)})\n`);

  function render(node: FlameNode, prefix: string, isLast: boolean, depth: number): void {
    if (depth > maxDepth) return;

    const pct      = (node.inclusiveNs / refNs * 100).toFixed(1);
    const selfPct  = (node.exclusiveNs / refNs * 100).toFixed(1);
    const branch   = isLast ? '└── ' : '├── ';
    const loc      = node.file ? ` [${node.file}:${node.line ?? '?'}]` : '';
    const selfStr  = node.exclusiveNs > 0 && node.children.size > 0
      ? `  self=${ns(node.exclusiveNs)} (${selfPct}%)`
      : '';

    lines.push(
      `${prefix}${branch}${node.name}${loc}\n` +
      `${prefix}${isLast ? '    ' : '│   '}    ${ns(node.inclusiveNs)} (${pct}%)  ×${node.count}${selfStr}`
    );

    const kids = [...node.children.values()]
      .filter(c => c.inclusiveNs >= minNs)
      .sort((a, b) => b.inclusiveNs - a.inclusiveNs);

    const childPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < kids.length; i++) {
      render(kids[i], childPrefix, i === kids.length - 1, depth + 1);
    }
  }

  const topLevel = [...fg.root.children.values()]
    .filter(c => c.inclusiveNs >= minNs)
    .sort((a, b) => b.inclusiveNs - a.inclusiveNs);

  for (let i = 0; i < topLevel.length; i++) {
    render(topLevel[i], '', i === topLevel.length - 1, 1);
  }

  // Self-time summary: top 10 hottest exclusive zones
  const allNodes: FlameNode[] = [];
  function collect(n: FlameNode): void {
    if (n.name !== '<root>' && !n.name.startsWith('thread:')) allNodes.push(n);
    for (const c of n.children.values()) collect(c);
  }
  collect(fg.root);

  const hottest = allNodes
    .filter(n => n.exclusiveNs > 0)
    .sort((a, b) => b.exclusiveNs - a.exclusiveNs)
    .slice(0, 10);

  if (hottest.length > 0) {
    lines.push('\n── Self-time hotspots (exclusive) ──────────────────');
    for (const n of hottest) {
      const pct = (n.exclusiveNs / refNs * 100).toFixed(1);
      const loc = n.file ? `  ${n.file}:${n.line ?? '?'}` : '';
      lines.push(`  ${pct.padStart(5)}%  ${ns(n.exclusiveNs).padEnd(10)}  ${n.name}${loc}`);
    }
  }

  return lines.join('\n');
}

/**
 * Emit folded stacks format (compatible with Brendan Gregg's flamegraph.pl
 * and speedscope / inferno).
 * Each line: "a;b;c <inclusive_ns>"
 */
export function formatFoldedStacks(fg: FlameGraph): string {
  const lines: string[] = [];

  function walk(node: FlameNode, path: string[]): void {
    const currentPath = [...path, node.name];
    // Emit a line for the self time (exclusive portion)
    if (node.exclusiveNs > 0) {
      lines.push(`${currentPath.join(';')} ${Math.round(node.exclusiveNs)}`);
    }
    for (const child of node.children.values()) {
      walk(child, currentPath);
    }
  }

  for (const child of fg.root.children.values()) {
    walk(child, []);
  }

  return lines.join('\n');
}
