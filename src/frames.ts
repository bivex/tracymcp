/**
 * Tracy Frame Parser
 * Parses FrameMark events to compute FPS and frame time statistics.
 */

import { readI64, readU64, readStringPayload, skipEvent } from './eventstream.js';

const QT_FrameMarkMsg      = 70;
const QT_FrameMarkMsgStart = 71;
const QT_FrameMarkMsgEnd   = 72;
const QT_FrameVsync        = 73;
const QT_StringData        = 104;
const QT_PlotName          = 106;
const QT_FrameName         = 110;

export interface FrameGroupStats {
  name: string;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p99Ms: number;
  droppedCount: number; // frames > 16.667ms (< 60fps)
  fpsAvg: number;       // 1000 / avgMs
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export class TracyFrameParser {
  parse(data: Buffer): Map<string, FrameGroupStats> {
    const strings = new Map<bigint, string>();
    // FrameMarkMsg: track last time per namePtr
    const lastFrameTime = new Map<bigint, bigint>();
    // Accumulate durations per namePtr
    const frameDurations = new Map<bigint, number[]>();
    // FrameMarkMsgStart: pending start times per namePtr
    const frameStarts = new Map<bigint, bigint>();

    let offset = 0;
    while (offset < data.length) {
      if (offset >= data.length) break;
      const type = data[offset];
      offset++;

      switch (type) {
        case QT_StringData:
        case QT_PlotName:
        case QT_FrameName:
        case 105: // ThreadName
        case 107: // SourceLocationPayload
        case 110: // FrameName (already listed)
        case 112: // ExternalName
        case 113: // ExternalThreadName
        case 116: { // FiberName
          const r = readStringPayload(data, offset, true);
          strings.set(r.ptr, r.str);
          offset = r.next;
          break;
        }

        case QT_FrameMarkMsg: {
          // time(8) + namePtr(8) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const namePtr = readU64(data, offset + 8);
          offset += 16;

          const prev = lastFrameTime.get(namePtr);
          if (prev !== undefined) {
            const durationMs = Number(timeNs - prev) / 1_000_000;
            if (!frameDurations.has(namePtr)) frameDurations.set(namePtr, []);
            frameDurations.get(namePtr)!.push(durationMs);
          }
          lastFrameTime.set(namePtr, timeNs);
          break;
        }

        case QT_FrameMarkMsgStart: {
          // time(8) + namePtr(8) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const namePtr = readU64(data, offset + 8);
          offset += 16;
          frameStarts.set(namePtr, timeNs);
          break;
        }

        case QT_FrameMarkMsgEnd: {
          // time(8) + namePtr(8) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const namePtr = readU64(data, offset + 8);
          offset += 16;

          const startNs = frameStarts.get(namePtr);
          if (startNs !== undefined) {
            const durationMs = Number(timeNs - startNs) / 1_000_000;
            if (!frameDurations.has(namePtr)) frameDurations.set(namePtr, []);
            frameDurations.get(namePtr)!.push(durationMs);
            frameStarts.delete(namePtr);
          }
          break;
        }

        case QT_FrameVsync:
          // time(8) + id(4) = 12 bytes — skip
          offset = skipEvent(data, offset, type);
          break;

        default:
          offset = skipEvent(data, offset, type);
          break;
      }
    }

    // Build stats
    const result = new Map<string, FrameGroupStats>();

    for (const [namePtr, durations] of frameDurations) {
      if (durations.length === 0) continue;

      const name = namePtr === 0n
        ? 'Frame'
        : (strings.get(namePtr) ?? `frame_0x${namePtr.toString(16)}`);

      durations.sort((a, b) => a - b);
      const total = durations.reduce((s, v) => s + v, 0);
      const avg = total / durations.length;
      const dropped = durations.filter(d => d > 16.667).length;

      const stats: FrameGroupStats = {
        name,
        count: durations.length,
        totalMs: total,
        minMs: durations[0],
        maxMs: durations[durations.length - 1],
        avgMs: avg,
        p50Ms: percentile(durations, 0.5),
        p99Ms: percentile(durations, 0.99),
        droppedCount: dropped,
        fpsAvg: avg > 0 ? 1000 / avg : 0,
      };

      result.set(name, stats);
    }

    return result;
  }

  format(stats: Map<string, FrameGroupStats>): string {
    if (stats.size === 0) {
      return 'No frame mark events found in trace.';
    }

    const lines: string[] = ['Frame Statistics\n================'];

    for (const s of stats.values()) {
      lines.push(`\nGroup: ${s.name}`);
      lines.push(`  Frames:        ${s.count}`);
      lines.push(`  Avg FPS:       ${s.fpsAvg.toFixed(1)}`);
      lines.push(`  Avg time:      ${s.avgMs.toFixed(3)} ms`);
      lines.push(`  Min time:      ${s.minMs.toFixed(3)} ms`);
      lines.push(`  Max time:      ${s.maxMs.toFixed(3)} ms`);
      lines.push(`  P50 time:      ${s.p50Ms.toFixed(3)} ms`);
      lines.push(`  P99 time:      ${s.p99Ms.toFixed(3)} ms`);
      lines.push(`  Total time:    ${s.totalMs.toFixed(3)} ms`);
      lines.push(`  Dropped (>16.667ms): ${s.droppedCount} (${s.count > 0 ? ((s.droppedCount / s.count) * 100).toFixed(1) : 0}%)`);
    }

    return lines.join('\n');
  }
}
