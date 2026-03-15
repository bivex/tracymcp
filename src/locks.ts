/**
 * Tracy Lock Contention Parser
 * Parses mutex/lock wait, obtain, and release events from synthetic event streams.
 */

import { readI64, readU64, readStringPayload, skipEvent } from './eventstream.js';

const QT_LockAnnounce       = 75;
const QT_LockTerminate      = 76;
const QT_LockWait           = 18;
const QT_LockObtain         = 19;
const QT_LockRelease        = 20;
const QT_LockSharedWait     = 21;
const QT_LockSharedObtain   = 22;
const QT_LockSharedRelease  = 23;
const QT_LockName           = 24;
const QT_LockMark           = 77;
const QT_SingleStringData   = 99;
const QT_StringData         = 104;

export interface LockStats {
  id: number;
  name?: string;
  totalWaitMs: number;
  maxWaitMs: number;
  obtainCount: number;
  contentionCount: number; // obtain events where wait > 0.1ms
}

interface PendingWait {
  threadId: number;
  waitStartNs: bigint;
}

export class TracyLockParser {
  parse(data: Buffer): LockStats[] {
    const strings = new Map<bigint, string>();
    let pendingString: string | null = null;

    // Per-lock accumulators
    const lockNames = new Map<number, string>();
    const lockTotalWait = new Map<number, number>(); // ms
    const lockMaxWait = new Map<number, number>(); // ms
    const lockObtainCount = new Map<number, number>();
    const lockContentionCount = new Map<number, number>();

    // Pending waits: lockId → list of pending waits by thread
    const pendingWaits = new Map<number, Map<number, PendingWait>>();

    const ensureLock = (id: number) => {
      if (!lockTotalWait.has(id)) {
        lockTotalWait.set(id, 0);
        lockMaxWait.set(id, 0);
        lockObtainCount.set(id, 0);
        lockContentionCount.set(id, 0);
        pendingWaits.set(id, new Map());
      }
    };

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

        case QT_LockAnnounce: {
          // id(4) + time(8) + lckloc(8) + type(1) = 21 bytes
          if (offset + 21 > data.length) { offset = data.length; break; }
          const id = data.readUInt32LE(offset);
          offset += 21;
          ensureLock(id);
          break;
        }

        case QT_LockTerminate: {
          // id(4) + time(8) = 12 bytes
          if (offset + 12 > data.length) { offset = data.length; break; }
          offset += 12;
          break;
        }

        case QT_LockName: {
          // id(4) = 4 bytes — name came from preceding SingleStringData
          if (offset + 4 > data.length) { offset = data.length; break; }
          const id = data.readUInt32LE(offset);
          offset += 4;
          if (pendingString !== null) {
            lockNames.set(id, pendingString);
            pendingString = null;
          }
          break;
        }

        case QT_LockWait:
        case QT_LockSharedWait: {
          // thread(4) + id(4) + time(8) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          const threadId = data.readUInt32LE(offset);
          const lockId = data.readUInt32LE(offset + 4);
          const timeNs = readI64(data, offset + 8);
          offset += 16;
          ensureLock(lockId);
          const waits = pendingWaits.get(lockId)!;
          waits.set(threadId, { threadId, waitStartNs: timeNs });
          break;
        }

        case QT_LockObtain:
        case QT_LockSharedObtain: {
          // thread(4) + id(4) + time(8) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          const threadId = data.readUInt32LE(offset);
          const lockId = data.readUInt32LE(offset + 4);
          const obtainTimeNs = readI64(data, offset + 8);
          offset += 16;
          ensureLock(lockId);

          const waits = pendingWaits.get(lockId)!;
          const pending = waits.get(threadId);
          if (pending) {
            const waitMs = Number(obtainTimeNs - pending.waitStartNs) / 1_000_000;
            lockTotalWait.set(lockId, lockTotalWait.get(lockId)! + waitMs);
            lockMaxWait.set(lockId, Math.max(lockMaxWait.get(lockId)!, waitMs));
            lockObtainCount.set(lockId, lockObtainCount.get(lockId)! + 1);
            if (waitMs > 0.1) {
              lockContentionCount.set(lockId, lockContentionCount.get(lockId)! + 1);
            }
            waits.delete(threadId);
          } else {
            // Unmatched obtain (no preceding wait) — still count
            lockObtainCount.set(lockId, lockObtainCount.get(lockId)! + 1);
          }
          break;
        }

        case QT_LockRelease: {
          // id(4) + time(8) = 12 bytes
          if (offset + 12 > data.length) { offset = data.length; break; }
          offset += 12;
          break;
        }

        case QT_LockSharedRelease: {
          // id(4) + time(8) + thread(4) = 16 bytes
          if (offset + 16 > data.length) { offset = data.length; break; }
          offset += 16;
          break;
        }

        case QT_LockMark: {
          // thread(4) + id(4) + srcloc(8) = 16 bytes — skip
          if (offset + 16 > data.length) { offset = data.length; break; }
          offset += 16;
          break;
        }

        default:
          offset = skipEvent(data, offset, type);
          break;
      }
    }

    // Build result
    const result: LockStats[] = [];
    for (const id of lockTotalWait.keys()) {
      result.push({
        id,
        name: lockNames.get(id),
        totalWaitMs: lockTotalWait.get(id) ?? 0,
        maxWaitMs: lockMaxWait.get(id) ?? 0,
        obtainCount: lockObtainCount.get(id) ?? 0,
        contentionCount: lockContentionCount.get(id) ?? 0,
      });
    }

    // Sort by total wait descending
    result.sort((a, b) => b.totalWaitMs - a.totalWaitMs);
    return result;
  }

  format(locks: LockStats[], minWaitMs: number = 0.1): string {
    const filtered = locks.filter(l => l.totalWaitMs >= minWaitMs);

    if (filtered.length === 0) {
      return `No lock contention found above ${minWaitMs} ms total wait.`;
    }

    const lines: string[] = [`Lock Contention Analysis (${filtered.length} lock(s)):\n`];

    for (const l of filtered) {
      const nameStr = l.name ? `"${l.name}"` : `id=${l.id}`;
      lines.push(`Lock ${nameStr}`);
      lines.push(`  Total wait:   ${l.totalWaitMs.toFixed(3)} ms`);
      lines.push(`  Max wait:     ${l.maxWaitMs.toFixed(3)} ms`);
      lines.push(`  Obtains:      ${l.obtainCount}`);
      lines.push(`  Contended:    ${l.contentionCount} times (wait > 0.1ms)`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
