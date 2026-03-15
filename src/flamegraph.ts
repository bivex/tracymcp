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

// ── Top Table ─────────────────────────────────────────────────────────────────

export interface TopEntry {
  name: string;
  file?: string;
  line?: number;
  selfNs: number;
  selfPct: number;
  inclusiveNs: number;
  inclusivePct: number;
  count: number;
  avgSelfNs: number;
}

/**
 * Build a flat list of all zones sorted by exclusive (self) time descending.
 * This is the "Top Table" / "hot functions" view.
 */
export function buildTopTable(fg: FlameGraph): TopEntry[] {
  let totalNs = 0;
  for (const c of fg.root.children.values()) totalNs += c.inclusiveNs;

  const entries: TopEntry[] = [];

  function collect(node: FlameNode): void {
    if (node.name === '<root>' || node.name.startsWith('thread:')) {
      for (const c of node.children.values()) collect(c);
      return;
    }
    entries.push({
      name:         node.name,
      file:         node.file,
      line:         node.line,
      selfNs:       node.exclusiveNs,
      selfPct:      totalNs > 0 ? node.exclusiveNs / totalNs * 100 : 0,
      inclusiveNs:  node.inclusiveNs,
      inclusivePct: totalNs > 0 ? node.inclusiveNs / totalNs * 100 : 0,
      count:        node.count,
      avgSelfNs:    node.count > 0 ? node.exclusiveNs / node.count : 0,
    });
    for (const c of node.children.values()) collect(c);
  }
  collect(fg.root);

  // Deduplicate: same name can appear at multiple call-path positions.
  // Merge by name (sum times, add counts).
  const merged = new Map<string, TopEntry>();
  for (const e of entries) {
    if (merged.has(e.name)) {
      const m = merged.get(e.name)!;
      m.selfNs       += e.selfNs;
      m.inclusiveNs  += e.inclusiveNs;
      m.count        += e.count;
    } else {
      merged.set(e.name, { ...e });
    }
  }

  // Recompute derived fields after merge
  for (const m of merged.values()) {
    m.selfPct       = totalNs > 0 ? m.selfNs / totalNs * 100 : 0;
    m.inclusivePct  = totalNs > 0 ? m.inclusiveNs / totalNs * 100 : 0;
    m.avgSelfNs     = m.count > 0 ? m.selfNs / m.count : 0;
  }

  return [...merged.values()].sort((a, b) => b.selfNs - a.selfNs);
}

export function formatTopTable(entries: TopEntry[], limit = 20): string {
  const top = entries.slice(0, limit);
  if (top.length === 0) return 'No data.';

  const ms = (n: number) => (n / 1_000_000).toFixed(3);
  const pct = (n: number) => n.toFixed(1).padStart(5) + '%';
  const bar = (pct: number, w = 20) => '█'.repeat(Math.max(0, Math.round(pct / 100 * w))).padEnd(w);

  const header =
    `${'#'.padStart(3)}  ${'Self%'.padStart(6)}  ${'Self ms'.padStart(8)}  ${'Incl%'.padStart(6)}  ${'Incl ms'.padStart(8)}  ${'×Calls'.padStart(6)}  ${'Avg self'.padStart(9)}  Name`;
  const sep = '─'.repeat(header.length + 22);

  const rows = top.map((e, i) => {
    const loc = e.file ? `\n${''.padStart(40)}  ${e.file}:${e.line ?? '?'}` : '';
    return (
      `${String(i + 1).padStart(3)}  ${pct(e.selfPct)}  ${ms(e.selfNs).padStart(8)}  ` +
      `${pct(e.inclusivePct)}  ${ms(e.inclusiveNs).padStart(8)}  ` +
      `${String(e.count).padStart(6)}  ${ms(e.avgSelfNs).padStart(9)}  ` +
      `${bar(e.selfPct)} ${e.name}${loc}`
    );
  });

  return `Top ${top.length} zones by self (exclusive) time\n\n${header}\n${sep}\n${rows.join('\n')}`;
}

// ── Icicle Graph ──────────────────────────────────────────────────────────────

interface IcicleSlot {
  node: FlameNode;
  x: number;   // column offset (chars)
  w: number;   // width (chars)
}

/**
 * ASCII icicle graph — grows top-down, width proportional to inclusive time.
 * Root at top; children placed under parent in proportion to their share.
 */
export function formatIcicleGraph(
  fg: FlameGraph,
  options: { width?: number; maxDepth?: number; minPercent?: number } = {}
): string {
  const { width = 100, maxDepth = 6, minPercent = 0.5 } = options;

  let totalNs = 0;
  for (const c of fg.root.children.values()) totalNs += c.inclusiveNs;
  if (totalNs === 0) return 'No data.';

  const minNs = totalNs * minPercent / 100;

  // Build level-by-level slots
  const levels: IcicleSlot[][] = [];

  // Level 0: top-level zones
  const level0: IcicleSlot[] = [];
  let x0 = 0;
  for (const child of [...fg.root.children.values()].sort((a, b) => b.inclusiveNs - a.inclusiveNs)) {
    if (child.inclusiveNs < minNs) continue;
    const w = Math.max(1, Math.round(child.inclusiveNs / totalNs * width));
    level0.push({ node: child, x: x0, w });
    x0 += w;
  }
  if (level0.length === 0) return 'No data.';
  levels.push(level0);

  for (let depth = 1; depth < maxDepth; depth++) {
    const prevLevel = levels[depth - 1];
    const nextLevel: IcicleSlot[] = [];

    for (const slot of prevLevel) {
      const children = [...slot.node.children.values()]
        .filter(c => c.inclusiveNs >= minNs)
        .sort((a, b) => b.inclusiveNs - a.inclusiveNs);
      if (children.length === 0) continue;

      let cx = slot.x;
      const parentNs = children.reduce((s, c) => s + c.inclusiveNs, 0);

      for (const child of children) {
        const cw = Math.max(1, Math.round(child.inclusiveNs / Math.max(parentNs, 1) * slot.w));
        if (cx + cw > slot.x + slot.w) break; // don't overflow parent
        nextLevel.push({ node: child, x: cx, w: cw });
        cx += cw;
      }
    }

    if (nextLevel.length === 0) break;
    levels.push(nextLevel);
  }

  // Render
  // Choose a gradient of fill chars by depth
  const fills = ['█', '▓', '▒', '░', '▪', '·'];

  const lines: string[] = [
    `Icicle Graph  (total: ${ns(totalNs)}, width = ${width} chars)\n`,
    '(top → deep; width ∝ inclusive time)\n',
  ];

  for (let d = 0; d < levels.length; d++) {
    const chars = new Array(width).fill(' ');
    const fill  = fills[d % fills.length];

    for (const slot of levels[d]) {
      if (slot.w < 1 || slot.x >= width) continue;
      const availW = Math.min(slot.w, width - slot.x);
      if (availW <= 0) continue;

      const pct  = (slot.node.inclusiveNs / totalNs * 100).toFixed(0);
      const raw  = slot.node.name + ' ' + pct + '%';
      // Fill the slot
      if (availW <= 2) {
        chars[slot.x] = fill;
      } else {
        chars[slot.x] = '[';
        chars[slot.x + availW - 1] = ']';
        const inner = availW - 2;
        const label = raw.length > inner ? raw.slice(0, inner - 1) + '…' : raw.padEnd(inner);
        for (let i = 0; i < inner; i++) {
          chars[slot.x + 1 + i] = label[i];
        }
      }
    }
    lines.push(chars.join(''));
  }

  lines.push('');
  lines.push(`Depth: ${levels.length} level(s)  |  min_percent=${minPercent}%`);
  return lines.join('\n');
}

// ── Call Graph ────────────────────────────────────────────────────────────────

export interface CallEdge {
  caller: string;
  callee: string;
  totalNs: number;    // total time transferred on this edge
  calls: number;
}

export interface CallGraphData {
  nodes: Map<string, { selfNs: number; inclusiveNs: number; count: number; file?: string; line?: number }>;
  edges: CallEdge[];
  totalNs: number;
}

/**
 * Extract a call graph (caller→callee edges) from the flame tree.
 */
export function buildCallGraph(fg: FlameGraph): CallGraphData {
  let totalNs = 0;
  for (const c of fg.root.children.values()) totalNs += c.inclusiveNs;

  const nodes = new Map<string, { selfNs: number; inclusiveNs: number; count: number; file?: string; line?: number }>();
  const edgeMap = new Map<string, CallEdge>();

  function walk(node: FlameNode, parentName?: string): void {
    if (node.name === '<root>' || node.name.startsWith('thread:')) {
      for (const c of node.children.values()) walk(c);
      return;
    }

    // Merge node data (same name may appear at multiple positions)
    if (!nodes.has(node.name)) {
      nodes.set(node.name, { selfNs: 0, inclusiveNs: 0, count: 0, file: node.file, line: node.line });
    }
    const n = nodes.get(node.name)!;
    n.selfNs      += node.exclusiveNs;
    n.inclusiveNs += node.inclusiveNs;
    n.count       += node.count;

    if (parentName && parentName !== node.name) {
      const edgeKey = `${parentName}→${node.name}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { caller: parentName, callee: node.name, totalNs: 0, calls: 0 });
      }
      const e = edgeMap.get(edgeKey)!;
      e.totalNs += node.inclusiveNs;
      e.calls   += node.count;
    }

    for (const child of node.children.values()) walk(child, node.name);
  }

  walk(fg.root);

  const edges = [...edgeMap.values()].sort((a, b) => b.totalNs - a.totalNs);
  return { nodes, edges, totalNs };
}

/**
 * Format call graph as Graphviz DOT (render with: dot -Tsvg -o out.svg)
 * Node size/color reflects self time; edge thickness reflects inclusive time transferred.
 */
export function formatCallGraphDot(cg: CallGraphData): string {
  const { nodes, edges, totalNs } = cg;
  if (totalNs === 0) return 'digraph tracy { label="No data"; }';

  const lines: string[] = [
    'digraph tracy_callgraph {',
    '  rankdir=LR;',
    '  bgcolor="#1a1a2e";',
    '  node [shape=box, style="filled,rounded", fontname="monospace", fontsize=10, fontcolor="white"];',
    '  edge [fontname="monospace", fontsize=9, fontcolor="#aaaaaa"];',
    '',
  ];

  // Heat color: self% → red channel
  function heatColor(selfPct: number): string {
    const t = Math.min(1, selfPct / 30); // saturate at 30%
    const r = Math.round(40  + t * 200);
    const g = Math.round(80  - t * 50);
    const b = Math.round(130 - t * 90);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  function sanitize(s: string): string {
    return '"' + s.replace(/"/g, '\\"') + '"';
  }

  for (const [name, n] of nodes) {
    const selfPct = totalNs > 0 ? n.selfNs / totalNs * 100 : 0;
    const inclPct = totalNs > 0 ? n.inclusiveNs / totalNs * 100 : 0;
    const label   = `${name}\\nself ${selfPct.toFixed(1)}%  incl ${inclPct.toFixed(1)}%\\n×${n.count}`;
    const color   = heatColor(selfPct);
    const penW    = Math.max(1, Math.round(selfPct / 5));
    lines.push(
      `  ${sanitize(name)} [label=${sanitize(label)}, fillcolor="${color}", penwidth=${penW}];`
    );
  }

  lines.push('');

  for (const e of edges) {
    const pct   = totalNs > 0 ? e.totalNs / totalNs * 100 : 0;
    const penW  = Math.max(0.5, Math.min(8, pct / 5)).toFixed(1);
    const label = `${pct.toFixed(1)}%  ×${e.calls}`;
    lines.push(
      `  ${sanitize(e.caller)} -> ${sanitize(e.callee)} [label=${sanitize(label)}, penwidth=${penW}];`
    );
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Format call graph as a readable text adjacency list.
 */
export function formatCallGraphText(cg: CallGraphData): string {
  const { nodes, edges, totalNs } = cg;
  if (totalNs === 0) return 'No call graph data.';

  const lines: string[] = ['Call Graph\n'];

  // Nodes sorted by self time
  const sortedNodes = [...nodes.entries()].sort((a, b) => b[1].selfNs - a[1].selfNs);
  lines.push('Nodes (sorted by self time):');
  lines.push(`  ${'Name'.padEnd(30)} ${'Self%'.padStart(6)} ${'Incl%'.padStart(6)} ${'×'.padStart(6)}`);
  lines.push('  ' + '─'.repeat(54));
  for (const [name, n] of sortedNodes) {
    const sp = (n.selfNs / totalNs * 100).toFixed(1).padStart(5);
    const ip = (n.inclusiveNs / totalNs * 100).toFixed(1).padStart(5);
    const loc = n.file ? `  ${n.file}:${n.line ?? '?'}` : '';
    lines.push(`  ${name.padEnd(30)} ${sp}%  ${ip}%  ${String(n.count).padStart(5)}${loc}`);
  }

  lines.push('\nEdges (sorted by time transferred, caller → callee):');
  lines.push(`  ${'Caller'.padEnd(25)} → ${'Callee'.padEnd(25)} ${'%'.padStart(6)} ${'×'.padStart(6)}`);
  lines.push('  ' + '─'.repeat(68));
  for (const e of edges.slice(0, 40)) {
    const pct = (e.totalNs / totalNs * 100).toFixed(1).padStart(5);
    lines.push(
      `  ${e.caller.padEnd(25)} → ${e.callee.padEnd(25)} ${pct}%  ${String(e.calls).padStart(5)}`
    );
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

// ── Thread Profiling ──────────────────────────────────────────────────────────

export interface ThreadZoneStat {
  name: string;
  file?: string;
  line?: number;
  selfNs: number;
  inclusiveNs: number;
  count: number;
}

export interface ThreadProfile {
  threadId: string;
  activeNs: number;
  traceSpanNs: number;
  utilizationPct: number;
  zones: ThreadZoneStat[];
  startNs: number;
  endNs: number;
}

export interface ThreadProfileResult {
  threads: ThreadProfile[];
  traceSpanNs: number;
  sharedZones: Array<{ name: string; threads: string[]; totalNs: number }>;
}

export function buildThreadProfile(unwrapCsv: string): ThreadProfileResult {
  interface RawCall { name: string; file?: string; line?: number; startNs: number; endNs: number; thread: string; }
  const calls: RawCall[] = [];
  const csvLines = unwrapCsv.split('\n');
  for (let i = 1; i < csvLines.length; i++) {
    const p = csvLines[i].split(',');
    if (p.length < 6) continue;
    const startNs = parseInt(p[3], 10), execNs = parseInt(p[4], 10);
    if (isNaN(startNs) || isNaN(execNs) || execNs <= 0) continue;
    calls.push({ name: p[0], file: p[1] || undefined, line: p[2] ? parseInt(p[2], 10) : undefined,
                 startNs, endNs: startNs + execNs, thread: p[5] || '0' });
  }
  if (calls.length === 0) return { threads: [], traceSpanNs: 0, sharedZones: [] };

  const globalMaxNs  = Math.max(...calls.map(c => c.endNs));
  const globalMinNs  = Math.min(...calls.map(c => c.startNs));
  const traceSpanNs  = globalMaxNs - globalMinNs;

  const byThread = new Map<string, RawCall[]>();
  for (const c of calls) {
    if (!byThread.has(c.thread)) byThread.set(c.thread, []);
    byThread.get(c.thread)!.push(c);
  }

  const profiles: ThreadProfile[] = [];

  for (const [threadId, tCalls] of byThread) {
    tCalls.sort((a, b) => a.startNs - b.startNs);
    const threadMin = tCalls[0].startNs;
    const threadMax = Math.max(...tCalls.map(c => c.endNs));

    interface Frame { name: string; file?: string; line?: number; startNs: number; endNs: number; childNs: number; }
    const stack: Frame[] = [];
    const zoneMap = new Map<string, ThreadZoneStat>();
    let topLevelActiveNs = 0;

    function finishFrame(f: Frame, depth: number): void {
      const incl   = f.endNs - f.startNs;
      const selfNs = Math.max(0, incl - f.childNs);  // clamp: child time may exceed parent due to overlap
      if (!zoneMap.has(f.name))
        zoneMap.set(f.name, { name: f.name, file: f.file, line: f.line, selfNs: 0, inclusiveNs: 0, count: 0 });
      const z = zoneMap.get(f.name)!;
      z.selfNs += selfNs; z.inclusiveNs += incl; z.count++;
      if (depth === 0) topLevelActiveNs += incl;
    }

    for (const call of tCalls) {
      while (stack.length > 0 && stack[stack.length - 1].endNs <= call.startNs) {
        const f = stack.pop()!;
        finishFrame(f, stack.length);
        if (stack.length > 0) stack[stack.length - 1].childNs += f.endNs - f.startNs;
      }
      stack.push({ name: call.name, file: call.file, line: call.line, startNs: call.startNs, endNs: call.endNs, childNs: 0 });
    }
    while (stack.length > 0) {
      const f = stack.pop()!;
      finishFrame(f, stack.length);
      if (stack.length > 0) stack[stack.length - 1].childNs += f.endNs - f.startNs;
    }

    profiles.push({
      threadId, activeNs: topLevelActiveNs, traceSpanNs,
      utilizationPct: traceSpanNs > 0 ? topLevelActiveNs / traceSpanNs * 100 : 0,
      zones: [...zoneMap.values()].sort((a, b) => b.selfNs - a.selfNs),
      startNs: threadMin, endNs: threadMax,
    });
  }

  profiles.sort((a, b) => b.activeNs - a.activeNs);

  const zoneThreads = new Map<string, Set<string>>();
  const zoneTotals  = new Map<string, number>();
  for (const tp of profiles) {
    for (const z of tp.zones) {
      if (!zoneThreads.has(z.name)) zoneThreads.set(z.name, new Set());
      zoneThreads.get(z.name)!.add(tp.threadId);
      zoneTotals.set(z.name, (zoneTotals.get(z.name) ?? 0) + z.inclusiveNs);
    }
  }
  const sharedZones = [...zoneThreads.entries()]
    .filter(([, t]) => t.size > 1)
    .map(([name, t]) => ({ name, threads: [...t], totalNs: zoneTotals.get(name) ?? 0 }))
    .sort((a, b) => b.totalNs - a.totalNs);

  return { threads: profiles, traceSpanNs, sharedZones };
}

export function formatThreadProfile(result: ThreadProfileResult): string {
  const { threads, traceSpanNs, sharedZones } = result;
  if (threads.length === 0) return 'No thread data found.';

  const msf  = (n: number) => (n / 1_000_000).toFixed(2);
  const bar  = (p: number, w = 30) => '█'.repeat(Math.max(0, Math.round(p / 100 * w))).padEnd(w);
  const pct  = (n: number) => n.toFixed(1).padStart(5) + '%';
  const out: string[] = [];

  out.push(`Thread Profile  (trace span: ${msf(traceSpanNs)}ms, ${threads.length} thread(s))\n`);

  out.push('Summary');
  out.push(`  ${'Thread'.padEnd(12)} ${'Active ms'.padStart(10)} ${'Util%'.padStart(6)}  ${'CPU utilization'.padEnd(32)} ${'#Zones'.padStart(6)}`);
  out.push('  ' + '─'.repeat(72));
  for (const tp of threads) {
    out.push(
      `  ${('Thread-' + tp.threadId).padEnd(12)} ${msf(tp.activeNs).padStart(10)} ${pct(tp.utilizationPct)}  ` +
      `${bar(tp.utilizationPct, 32)} ${String(tp.zones.length).padStart(6)}`
    );
  }

  for (const tp of threads) {
    out.push(`\n── Thread-${tp.threadId}  (active ${msf(tp.activeNs)}ms  util ${pct(tp.utilizationPct)}) ──`);
    out.push(`   ${'Name'.padEnd(28)} ${'Self%'.padStart(6)} ${'Self ms'.padStart(8)} ${'Incl ms'.padStart(8)} ${'×'.padStart(5)}  bar`);
    out.push('   ' + '─'.repeat(72));
    for (const z of tp.zones.slice(0, 15)) {
      // Percentage relative to global trace span — meaningful for cross-thread comparison
      const sp = traceSpanNs > 0 ? z.selfNs / traceSpanNs * 100 : 0;
      const ip = traceSpanNs > 0 ? z.inclusiveNs / traceSpanNs * 100 : 0;
      const loc = z.file ? `  ${z.file}:${z.line ?? '?'}` : '';
      out.push(
        `   ${z.name.padEnd(28)} ${pct(sp)} ${msf(z.selfNs).padStart(8)} ${msf(z.inclusiveNs).padStart(8)} ` +
        `${String(z.count).padStart(5)}  ${bar(sp, 12)}${loc}`
      );
    }
  }

  if (sharedZones.length > 0) {
    out.push('\n── Zones running on multiple threads ──');
    out.push(`   ${'Zone'.padEnd(28)} ${'Threads'.padEnd(20)} ${'Total ms'.padStart(10)}`);
    out.push('   ' + '─'.repeat(62));
    for (const z of sharedZones) {
      out.push(`   ${z.name.padEnd(28)} ${z.threads.map(t => 'T-' + t).join(', ').padEnd(20)} ${msf(z.totalNs).padStart(10)}`);
    }
  } else {
    out.push('\nNo zones shared across threads — clean thread separation.');
  }

  return out.join('\n');
}
