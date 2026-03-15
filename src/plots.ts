/**
 * Tracy Plot Parser
 * Parses TracyPlot custom metric events from synthetic event streams.
 */

import { readI64, readU64, readStringPayload, skipEvent } from './eventstream.js';

const QT_PlotDataInt    = 45;
const QT_PlotDataFloat  = 46;
const QT_PlotDataDouble = 47;
const QT_PlotName       = 106;
const QT_StringData     = 104;

export interface PlotStats {
  name: string;
  count: number;
  minVal: number;
  maxVal: number;
  avgVal: number;
  lastVal: number;
  durationMs: number; // lastTime - firstTime in ms
}

export class TracyPlotParser {
  parse(data: Buffer): Map<string, PlotStats> {
    const strings = new Map<bigint, string>();

    // Accumulate per-plot data
    const plotSamples = new Map<bigint, { vals: number[]; times: bigint[] }>();

    let offset = 0;
    while (offset < data.length) {
      if (offset >= data.length) break;
      const type = data[offset];
      offset++;

      switch (type) {
        case QT_StringData:
        case QT_PlotName:
        case 105: // ThreadName
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

        case QT_PlotDataInt: {
          // namePtr(8) + time(8) + val(int64 8) = 24 bytes
          if (offset + 24 > data.length) { offset = data.length; break; }
          const namePtr = readU64(data, offset);
          const timeNs = readI64(data, offset + 8);
          // Read val as int64
          const valLow = data.readUInt32LE(offset + 16);
          const valHigh = data.readInt32LE(offset + 20);
          const val = valHigh * 4294967296 + valLow;
          offset += 24;
          if (!plotSamples.has(namePtr)) plotSamples.set(namePtr, { vals: [], times: [] });
          const s = plotSamples.get(namePtr)!;
          s.vals.push(val);
          s.times.push(timeNs);
          break;
        }

        case QT_PlotDataFloat: {
          // namePtr(8) + time(8) + val(float 4) = 20 bytes
          if (offset + 20 > data.length) { offset = data.length; break; }
          const namePtr = readU64(data, offset);
          const timeNs = readI64(data, offset + 8);
          const val = data.readFloatLE(offset + 16);
          offset += 20;
          if (!plotSamples.has(namePtr)) plotSamples.set(namePtr, { vals: [], times: [] });
          const s = plotSamples.get(namePtr)!;
          s.vals.push(val);
          s.times.push(timeNs);
          break;
        }

        case QT_PlotDataDouble: {
          // namePtr(8) + time(8) + val(double 8) = 24 bytes
          if (offset + 24 > data.length) { offset = data.length; break; }
          const namePtr = readU64(data, offset);
          const timeNs = readI64(data, offset + 8);
          const val = data.readDoubleLE(offset + 16);
          offset += 24;
          if (!plotSamples.has(namePtr)) plotSamples.set(namePtr, { vals: [], times: [] });
          const s = plotSamples.get(namePtr)!;
          s.vals.push(val);
          s.times.push(timeNs);
          break;
        }

        default:
          offset = skipEvent(data, offset, type);
          break;
      }
    }

    // Build stats
    const result = new Map<string, PlotStats>();

    for (const [namePtr, { vals, times }] of plotSamples) {
      if (vals.length === 0) continue;

      const name = strings.get(namePtr) ?? `plot_0x${namePtr.toString(16)}`;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const last = vals[vals.length - 1];
      const firstTime = times[0];
      const lastTime = times[times.length - 1];
      const durationMs = Number(lastTime - firstTime) / 1_000_000;

      result.set(name, { name, count: vals.length, minVal: min, maxVal: max, avgVal: avg, lastVal: last, durationMs });
    }

    return result;
  }

  format(stats: Map<string, PlotStats>): string {
    if (stats.size === 0) {
      return 'No plot data found in trace.';
    }

    const lines: string[] = ['Plot Statistics\n==============='];

    for (const s of stats.values()) {
      lines.push(`\nPlot: ${s.name}`);
      lines.push(`  Samples:   ${s.count}`);
      lines.push(`  Min:       ${s.minVal}`);
      lines.push(`  Max:       ${s.maxVal}`);
      lines.push(`  Avg:       ${s.avgVal.toFixed(4)}`);
      lines.push(`  Last:      ${s.lastVal}`);
      lines.push(`  Duration:  ${s.durationMs.toFixed(3)} ms`);
    }

    return lines.join('\n');
  }
}
