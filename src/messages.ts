/**
 * Tracy Message Parser
 * Parses TracyMessage/TracyMessageL log events from synthetic event streams.
 */

import { readI64, readU64, readStringPayload, skipEvent } from './eventstream.js';

// QueueType constants
const QT_Message              = 2;
const QT_MessageColor         = 3;
const QT_MessageCallstack     = 4;
const QT_MessageColorCallstack = 5;
const QT_MessageAppInfo       = 6;
const QT_MessageLiteral       = 78;
const QT_MessageLiteralColor  = 79;
const QT_MessageLiteralCallstack = 80;
const QT_MessageLiteralColorCallstack = 81;
const QT_SingleStringData     = 99;
const QT_StringData           = 104;

const SEVERITY_NAMES = ['Trace', 'Debug', 'Info', 'Warning', 'Error', 'Fatal'];

const SEVERITY_ORDER: Record<string, number> = {
  Trace: 0, Debug: 1, Info: 2, Warning: 3, Error: 4, Fatal: 5,
};

export interface TracyMessage {
  timeMs: number;
  text: string;
  severity: string;
  source: 'User' | 'Tracy';
  r?: number;
  g?: number;
  b?: number;
}

export class TracyMessageParser {
  parse(data: Buffer): TracyMessage[] {
    const messages: TracyMessage[] = [];
    // string table: ptr → string (for StringData and literal lookups)
    const strings = new Map<bigint, string>();
    // pending dynamic message text from SingleStringData
    let pendingText: string | null = null;

    let offset = 0;
    while (offset < data.length) {
      if (offset >= data.length) break;
      const type = data[offset];
      offset++;

      switch (type) {
        case QT_SingleStringData: {
          const r = readStringPayload(data, offset, false);
          pendingText = r.str;
          offset = r.next;
          break;
        }

        case QT_StringData:
        case 105: // ThreadName — store anyway
        case 106: // PlotName
        case 110: // FrameName
        case 112: // ExternalName
        case 113: // ExternalThreadName
        case 116: // FiberName
        case 107: { // SourceLocationPayload
          const r = readStringPayload(data, offset, true);
          strings.set(r.ptr, r.str);
          offset = r.next;
          break;
        }

        case QT_Message:
        case QT_MessageCallstack: {
          // time(8) + metadata(1) = 9 bytes
          if (offset + 9 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const meta = data[offset + 8];
          offset += 9;
          const sevIdx = (meta >> 4) & 0x0f;
          const src = (meta & 0x0f) === 0 ? 'User' : 'Tracy';
          const text = pendingText ?? '';
          pendingText = null;
          messages.push({
            timeMs: Number(timeNs) / 1_000_000,
            text,
            severity: SEVERITY_NAMES[sevIdx] ?? 'Trace',
            source: src as 'User' | 'Tracy',
          });
          break;
        }

        case QT_MessageColor:
        case QT_MessageColorCallstack: {
          // time(8) + b(1) + g(1) + r(1) + metadata(1) = 12 bytes
          if (offset + 12 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const b = data[offset + 8];
          const g = data[offset + 9];
          const r = data[offset + 10];
          const meta = data[offset + 11];
          offset += 12;
          const sevIdx = (meta >> 4) & 0x0f;
          const src = (meta & 0x0f) === 0 ? 'User' : 'Tracy';
          const text = pendingText ?? '';
          pendingText = null;
          messages.push({
            timeMs: Number(timeNs) / 1_000_000,
            text,
            severity: SEVERITY_NAMES[sevIdx] ?? 'Trace',
            source: src as 'User' | 'Tracy',
            r, g, b,
          });
          break;
        }

        case QT_MessageLiteral:
        case QT_MessageLiteralCallstack: {
          // time(8) + textAndMetadata(8) = 16 bytes
          // The textAndMetadata field encodes ptr in upper bits and metadata in lower byte
          if (offset + 16 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const raw = readU64(data, offset + 8);
          offset += 16;
          const meta = Number(raw & 0xffn);
          const ptr = raw >> 8n;
          const sevIdx = (meta >> 4) & 0x0f;
          const src = (meta & 0x0f) === 0 ? 'User' : 'Tracy';
          const text = strings.get(ptr) ?? strings.get(raw) ?? `<literal:0x${ptr.toString(16)}>`;
          messages.push({
            timeMs: Number(timeNs) / 1_000_000,
            text,
            severity: SEVERITY_NAMES[sevIdx] ?? 'Trace',
            source: src as 'User' | 'Tracy',
          });
          break;
        }

        case QT_MessageLiteralColor:
        case QT_MessageLiteralColorCallstack: {
          // time(8) + b(1) + g(1) + r(1) + textAndMetadata(8) = 19 bytes
          if (offset + 19 > data.length) { offset = data.length; break; }
          const timeNs = readI64(data, offset);
          const b = data[offset + 8];
          const g = data[offset + 9];
          const r = data[offset + 10];
          const raw = readU64(data, offset + 11);
          offset += 19;
          const meta = Number(raw & 0xffn);
          const ptr = raw >> 8n;
          const sevIdx = (meta >> 4) & 0x0f;
          const src = (meta & 0x0f) === 0 ? 'User' : 'Tracy';
          const text = strings.get(ptr) ?? strings.get(raw) ?? `<literal:0x${ptr.toString(16)}>`;
          messages.push({
            timeMs: Number(timeNs) / 1_000_000,
            text,
            severity: SEVERITY_NAMES[sevIdx] ?? 'Trace',
            source: src as 'User' | 'Tracy',
            r, g, b,
          });
          break;
        }

        case QT_MessageAppInfo: {
          // time(8) = 8 bytes — skip, no user-visible message
          offset = skipEvent(data, offset, type);
          break;
        }

        default:
          offset = skipEvent(data, offset, type);
          break;
      }
    }

    return messages;
  }

  format(messages: TracyMessage[], filter?: string, limit?: number, minSeverity?: string): string {
    const minSevOrder = SEVERITY_ORDER[minSeverity ?? 'Trace'] ?? 0;

    let filtered = messages.filter(m => {
      if ((SEVERITY_ORDER[m.severity] ?? 0) < minSevOrder) return false;
      if (filter && !m.text.toLowerCase().includes(filter.toLowerCase())) return false;
      return true;
    });

    if (limit && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

    if (filtered.length === 0) {
      return 'No messages found matching the specified criteria.';
    }

    const lines: string[] = [`Messages (${filtered.length} shown):\n`];
    for (const m of filtered) {
      const timeStr = m.timeMs.toFixed(3).padStart(10);
      const sev = m.severity.padEnd(7);
      const src = m.source === 'Tracy' ? '[Tracy] ' : '';
      const color = m.r !== undefined ? ` [rgb(${m.r},${m.g},${m.b})]` : '';
      lines.push(`${timeStr} ms  ${sev}  ${src}${m.text}${color}`);
    }

    return lines.join('\n');
  }
}
