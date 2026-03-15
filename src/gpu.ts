/**
 * Tracy GPU Zone Parser
 * Parses GPU zone begin/end and GpuTime events from synthetic event streams.
 */

import { readI64, readU64, readStringPayload, skipEvent } from './eventstream.js';

const QT_GpuNewContext                   = 82;
const QT_GpuZoneBegin                    = 35;
const QT_GpuZoneBeginCallstack           = 36;
const QT_GpuZoneBeginAllocSrcLoc        = 37;
const QT_GpuZoneBeginAllocSrcLocCallstack = 38;
const QT_GpuZoneEnd                      = 39;
const QT_GpuZoneBeginSerial              = 40;
const QT_GpuZoneBeginCallstackSerial     = 41;
const QT_GpuZoneBeginAllocSrcLocSerial  = 42;
const QT_GpuZoneBeginAllocSrcLocCallstackSerial = 43;
const QT_GpuZoneEndSerial               = 44;
const QT_GpuTime                         = 50;
const QT_GpuCalibration                  = 63;
const QT_GpuTimeSync                     = 64;
const QT_SourceLocation                  = 74;
const QT_StringData                      = 104;
const QT_SingleStringData                = 99;

export interface GpuZoneTiming {
  name: string;
  count: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  context: number;
}

interface GpuBeginRecord {
  cpuTimeNs: bigint;
  queryId: number;
  context: number;
  srclocPtr: bigint;
  isCpuFallback: boolean;
}

interface SourceLocation {
  namePtr: bigint;
  funcPtr: bigint;
  filePtr: bigint;
  line: number;
}

export class TracyGpuParser {
  parse(data: Buffer): GpuZoneTiming[] {
    const strings = new Map<bigint, string>();
    // srclocId (sequential) → SourceLocation
    const sourceLocs: SourceLocation[] = [];
    // queryId → gpu timestamp
    const gpuTimes = new Map<number, bigint>();
    // pending begins: queryId → GpuBeginRecord
    const pendingBegins = new Map<number, GpuBeginRecord>();
    // queryId → cpuEnd time (for fallback)
    const cpuEndTimes = new Map<number, bigint>();

    // Accumulate per zone name
    const zoneByName = new Map<string, { count: number; totalMs: number; minMs: number; maxMs: number; context: number }>();

    const recordDuration = (name: string, durationMs: number, context: number) => {
      if (!zoneByName.has(name)) {
        zoneByName.set(name, { count: 0, totalMs: 0, minMs: Infinity, maxMs: -Infinity, context });
      }
      const z = zoneByName.get(name)!;
      z.count++;
      z.totalMs += durationMs;
      if (durationMs < z.minMs) z.minMs = durationMs;
      if (durationMs > z.maxMs) z.maxMs = durationMs;
    };

    const resolveZoneName = (srclocPtr: bigint): string => {
      // srclocPtr may be a sequential index into sourceLocs
      const idx = Number(srclocPtr);
      const loc = sourceLocs[idx];
      if (loc) {
        return strings.get(loc.namePtr) ?? strings.get(loc.funcPtr) ?? `gpu_zone_${idx}`;
      }
      // Try direct ptr lookup as a string key
      return strings.get(srclocPtr) ?? `gpu_zone_0x${srclocPtr.toString(16)}`;
    };

    let srclocCounter = 0;
    let pendingString: string | null = null;

    let offset = 0;
    while (offset < data.length) {
      if (offset >= data.length) break;
      const type = data[offset];
      offset++;

      switch (type) {
        case QT_SingleStringData: {
          const r = readStringPayload(data, offset, false);
          pendingString = r.str;
          offset = r.next;
          break;
        }

        case QT_StringData:
        case 105: // ThreadName
        case 106: // PlotName
        case 107: // SourceLocationPayload
        case 110: // FrameName
        case 112: // ExternalName
        case 113: // ExternalThreadName
        case 116: { // FiberName
          const r = readStringPayload(data, offset, true);
          strings.set(r.ptr, r.str);
          offset = r.next;
          break;
        }

        case QT_SourceLocation: {
          // name(8)+func(8)+file(8)+line(4)+r+g+b = 31 bytes
          if (offset + 31 > data.length) { offset = data.length; break; }
          const namePtr = readU64(data, offset);
          const funcPtr = readU64(data, offset + 8);
          const filePtr = readU64(data, offset + 16);
          const line = data.readUInt32LE(offset + 24);
          offset += 31;
          sourceLocs[srclocCounter++] = { namePtr, funcPtr, filePtr, line };
          break;
        }

        case QT_GpuNewContext: {
          // cpuTime(8)+gpuTime(8)+thread(4)+period(4)+context(1)+flags(1)+type(1) = 27 bytes
          if (offset + 27 > data.length) { offset = data.length; break; }
          offset += 27;
          break;
        }

        case QT_GpuZoneBegin:
        case QT_GpuZoneBeginCallstack:
        case QT_GpuZoneBeginSerial:
        case QT_GpuZoneBeginCallstackSerial: {
          // cpuTime(8)+thread(4)+queryId(2)+context(1)+srcloc(8) = 23 bytes
          if (offset + 23 > data.length) { offset = data.length; break; }
          const cpuTimeNs = readI64(data, offset);
          const queryId = data.readUInt16LE(offset + 12);
          const context = data[offset + 14];
          const srclocPtr = readU64(data, offset + 15);
          offset += 23;
          pendingBegins.set(queryId, { cpuTimeNs, queryId, context, srclocPtr, isCpuFallback: false });
          break;
        }

        case QT_GpuZoneBeginAllocSrcLoc:
        case QT_GpuZoneBeginAllocSrcLocCallstack:
        case QT_GpuZoneBeginAllocSrcLocSerial:
        case QT_GpuZoneBeginAllocSrcLocCallstackSerial: {
          // cpuTime(8)+thread(4)+queryId(2)+context(1) = 15 bytes (no srcloc field)
          if (offset + 15 > data.length) { offset = data.length; break; }
          const cpuTimeNs = readI64(data, offset);
          const queryId = data.readUInt16LE(offset + 12);
          const context = data[offset + 14];
          offset += 15;
          pendingBegins.set(queryId, { cpuTimeNs, queryId, context, srclocPtr: 0n, isCpuFallback: false });
          break;
        }

        case QT_GpuZoneEnd:
        case QT_GpuZoneEndSerial: {
          // cpuTime(8)+thread(4)+queryId(2)+context(1) = 15 bytes
          if (offset + 15 > data.length) { offset = data.length; break; }
          const cpuEndNs = readI64(data, offset);
          const queryId = data.readUInt16LE(offset + 12);
          offset += 15;
          cpuEndTimes.set(queryId, cpuEndNs);
          // Try to complete using GPU times if already available
          this.tryCompleteZone(queryId, pendingBegins, gpuTimes, cpuEndTimes, resolveZoneName, recordDuration);
          break;
        }

        case QT_GpuTime: {
          // gpuTime(8)+queryId(2)+context(1) = 11 bytes
          if (offset + 11 > data.length) { offset = data.length; break; }
          const gpuTimeNs = readI64(data, offset);
          const queryId = data.readUInt16LE(offset + 8);
          offset += 11;
          gpuTimes.set(queryId, gpuTimeNs);
          // Try to complete zone if we have begin and end for this query
          this.tryCompleteZone(queryId, pendingBegins, gpuTimes, cpuEndTimes, resolveZoneName, recordDuration);
          break;
        }

        case QT_GpuCalibration:
        case QT_GpuTimeSync:
          offset = skipEvent(data, offset, type);
          break;

        default:
          offset = skipEvent(data, offset, type);
          break;
      }
    }

    // Any remaining pending begins with CPU fallback
    for (const [queryId, begin] of pendingBegins) {
      const cpuEnd = cpuEndTimes.get(queryId);
      if (cpuEnd !== undefined) {
        const durationMs = Number(cpuEnd - begin.cpuTimeNs) / 1_000_000;
        if (durationMs > 0) {
          const name = resolveZoneName(begin.srclocPtr);
          recordDuration(name, durationMs, begin.context);
        }
      }
    }

    // Build result
    const result: GpuZoneTiming[] = [];
    for (const [name, z] of zoneByName) {
      result.push({
        name,
        count: z.count,
        totalMs: z.totalMs,
        avgMs: z.count > 0 ? z.totalMs / z.count : 0,
        minMs: z.minMs === Infinity ? 0 : z.minMs,
        maxMs: z.maxMs === -Infinity ? 0 : z.maxMs,
        context: z.context,
      });
    }

    result.sort((a, b) => b.totalMs - a.totalMs);
    return result;
  }

  private tryCompleteZone(
    queryId: number,
    pendingBegins: Map<number, GpuBeginRecord>,
    gpuTimes: Map<number, bigint>,
    cpuEndTimes: Map<number, bigint>,
    resolveZoneName: (ptr: bigint) => string,
    recordDuration: (name: string, durationMs: number, ctx: number) => void,
  ): void {
    const begin = pendingBegins.get(queryId);
    if (!begin) return;

    const gpuTime = gpuTimes.get(queryId);
    const cpuEnd = cpuEndTimes.get(queryId);

    // We need both a GPU begin time (a prior GpuTime for begin queryId) and a GPU end time
    // The protocol emits a GpuTime for the begin query and a GpuTime for the end query.
    // However, without knowing which GpuTime belongs to begin vs end, we use a heuristic:
    // if we have a GpuTime and a cpuEnd, compute GPU duration using cpuBegin as anchor.
    // Simpler: use cpu times as fallback when we have both begin and end.
    if (cpuEnd !== undefined) {
      const durationMs = Number(cpuEnd - begin.cpuTimeNs) / 1_000_000;
      if (durationMs >= 0) {
        const name = resolveZoneName(begin.srclocPtr);
        recordDuration(name, durationMs, begin.context);
        pendingBegins.delete(queryId);
        cpuEndTimes.delete(queryId);
      }
    }
  }

  format(zones: GpuZoneTiming[], maxAvgMs: number = 5, maxTotalMs: number = 50): string {
    if (zones.length === 0) {
      return 'No GPU zone events found in trace.';
    }

    const flagged = zones.filter(z => z.avgMs > maxAvgMs || z.totalMs > maxTotalMs);
    const lines: string[] = [`GPU Zone Analysis (${zones.length} zone(s), ${flagged.length} flagged):\n`];

    for (const z of zones) {
      const flags: string[] = [];
      if (z.avgMs > maxAvgMs) flags.push(`avg > ${maxAvgMs}ms`);
      if (z.totalMs > maxTotalMs) flags.push(`total > ${maxTotalMs}ms`);
      const flagStr = flags.length > 0 ? `  [SLOW: ${flags.join(', ')}]` : '';

      lines.push(`GPU zone: ${z.name} (context ${z.context})${flagStr}`);
      lines.push(`  Count:   ${z.count}`);
      lines.push(`  Total:   ${z.totalMs.toFixed(3)} ms`);
      lines.push(`  Avg:     ${z.avgMs.toFixed(3)} ms`);
      lines.push(`  Min:     ${z.minMs.toFixed(3)} ms`);
      lines.push(`  Max:     ${z.maxMs.toFixed(3)} ms`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
