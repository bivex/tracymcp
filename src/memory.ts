/**
 * Tracy Memory Profiling Parser
 * Analyzes memory allocations, leaks, and usage patterns
 */

// Memory event types from TracyQueue.hpp (QueueType enum, 0-based)
const enum MemEventType {
  MemAlloc = 25,
  MemAllocNamed = 26,
  MemFree = 27,
  MemFreeNamed = 28,
  MemAllocCallstack = 29,
  MemAllocCallstackNamed = 30,
  MemFreeCallstack = 31,
  MemFreeCallstackNamed = 32,
  MemDiscard = 33,
  MemDiscardCallstack = 34,
  MemNamePayload = 101,
  // String events — variable length, must be skipped correctly
  SingleStringData = 99,
  SecondStringData = 100,
  StringData = 104,
  MemCallstack = 200,   // custom: ptr(8)+frameCount(1)+[funcPtr(8)+filePtr(8)+line(4)]×N
}

export interface CallstackFrame {
  fn: string;
  file: string;
  line: number;
}

export interface MemoryAllocation {
  address: bigint;
  size: number;
  timestamp: bigint;
  allocated: boolean;
  freed: boolean;
  name?: string;
  thread: number;
  leaked?: boolean;
  callstack?: CallstackFrame[];
}

export interface MemoryStats {
  totalAllocated: number;    // bytes
  totalFreed: number;         // bytes
  currentUsage: number;       // bytes
  peakUsage: number;          // bytes
  allocationCount: number;
  freeCount: number;
  leaks: MemoryAllocation[];
  allocations: MemoryAllocation[];
}

export interface MemoryIssue {
  type: 'leak' | 'high-usage' | 'fragmentation' | 'spike' | 'high-frequency';
  severity: 'high' | 'medium' | 'low';
  address: bigint;
  size: number;
  count?: number;
  description: string;
  recommendation: string;
  callstack?: CallstackFrame[];
}

export interface MemoryAnalysisOptions {
  maxLeakSize?: number;        // bytes
  maxCurrentUsage?: number;    // bytes
  maxAllocCount?: number;      // threshold for "high-frequency"
}

// Helper function to read 48-bit size from char[6] array
function readSize48(data: Buffer, offset: number): number {
  // Tracy stores size in 6 bytes (48 bits) as little-endian
  const low = data.readUInt32LE(offset);
  const high = data.readUInt16LE(offset + 4);
  return low + (high * 0x100000000);
}

export class TracyMemoryParser {
  private allocations: Map<bigint, MemoryAllocation> = new Map();
  private allocationsByTime: MemoryAllocation[] = [];
  private peakUsage: number = 0;
  private totalAllocated: number = 0;
  private totalFreed: number = 0;
  private allocCount: number = 0;
  private freeCount: number = 0;
  private strings: Map<bigint, string> = new Map();
  private lastMemName: bigint = 0n;
  private callstacks: Map<bigint, CallstackFrame[]> = new Map();

  // Parse memory events from decompressed trace data
  parseMemoryEvents(data: Buffer): MemoryStats {
    let offset = 0;

    while (offset < data.length - 8) {
      // Save start position in case we need to recover
      const startOffset = offset;

      // Read event type (uint8)
      const eventType = data[offset];
      offset++;

      try {
        switch (eventType) {
          case MemEventType.MemAlloc: {
            // QueueMemAlloc: time(8) + thread(4) + ptr(8) + size[6]
            if (offset + 26 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);
            const size = readSize48(data, offset + 20);

            this.addAllocation(ptr, size, time, thread);
            offset += 26;
            break;
          }

          case MemEventType.MemAllocNamed: {
            // Same as MemAlloc, followed by MemNamePayload
            if (offset + 26 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);
            const size = readSize48(data, offset + 20);

            // Store the name for the next MemNamePayload event
            this.lastMemName = ptr;

            this.addAllocation(ptr, size, time, thread);
            offset += 26;
            break;
          }

          case MemEventType.MemFree: {
            // QueueMemFree: time(8) + thread(4) + ptr(8)
            if (offset + 20 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);

            this.addFree(ptr, time, thread);
            offset += 20;
            break;
          }

          case MemEventType.MemFreeNamed: {
            // Same as MemFree
            if (offset + 20 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);

            this.addFree(ptr, time, thread);
            this.lastMemName = ptr; // Store for potential name payload
            offset += 20;
            break;
          }

          case MemEventType.MemAllocCallstack:
          case MemEventType.MemAllocCallstackNamed: {
            // QueueMemAllocFat: time(8) + thread(4) + ptr(8) + size[6] + callstack(8)
            if (offset + 34 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);
            const size = readSize48(data, offset + 20);
            // Skip callstack pointer (8 bytes)
            if (eventType === MemEventType.MemAllocCallstackNamed) {
              this.lastMemName = ptr;
            }

            this.addAllocation(ptr, size, time, thread);
            offset += 34;
            break;
          }

          case MemEventType.MemFreeCallstack:
          case MemEventType.MemFreeCallstackNamed: {
            // QueueMemFreeFat: time(8) + thread(4) + ptr(8) + callstack(8)
            if (offset + 28 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const time = this.readInt64(data, offset);
            const thread = data.readUInt32LE(offset + 8);
            const ptr = this.readUInt64(data, offset + 12);
            // Skip callstack pointer

            this.addFree(ptr, time, thread);
            offset += 28;
            break;
          }

          case MemEventType.MemNamePayload: {
            // QueueMemNamePayload: name(8)
            if (offset + 8 > data.length) {
              offset = this.skipToEnd(data, offset);
              break;
            }

            const namePtr = this.readUInt64(data, offset);

            // Try to find the name in strings
            const nameStr = this.strings.get(namePtr);

            // Update the allocation with this name
            if (this.lastMemName !== 0n) {
              const alloc = this.allocations.get(this.lastMemName);
              if (alloc) {
                alloc.name = nameStr || `alloc_0x${this.lastMemName.toString(16)}`;
              }
            }

            offset += 8;
            break;
          }

          case MemEventType.StringData:
          case MemEventType.SingleStringData:
          case MemEventType.SecondStringData: {
            // [ptr(8)] + null-terminated string — variable length
            if (offset + 8 >= data.length) { offset = data.length; break; }
            const strPtr = this.readUInt64(data, offset);
            let strEnd = offset + 8;
            while (strEnd < data.length && data[strEnd] !== 0) strEnd++;
            const str = data.subarray(offset + 8, strEnd).toString('utf-8');
            this.strings.set(strPtr, str);
            offset = strEnd + 1; // skip NUL
            break;
          }

          case MemEventType.MemDiscard:
          case MemEventType.MemDiscardCallstack: {
            // Memory was freed without Tracy knowing
            // Just skip these events
            const baseSize = eventType === MemEventType.MemDiscard ? 20 : 28;
            if (offset + baseSize <= data.length) {
              offset += baseSize;
            } else {
              offset = this.skipToEnd(data, offset);
            }
            break;
          }

          case MemEventType.MemCallstack: {
            // ptr(8) + frameCount(1) + [funcPtr(8) + filePtr(8) + line(4)] × N
            if (offset + 9 > data.length) { offset = this.skipToEnd(data, offset); break; }
            const ptr = this.readUInt64(data, offset);
            const frameCount = data[offset + 8];
            offset += 9;
            const frames: CallstackFrame[] = [];
            for (let f = 0; f < frameCount && offset + 20 <= data.length; f++) {
              const funcPtr = this.readUInt64(data, offset);
              const filePtr = this.readUInt64(data, offset + 8);
              const line    = data.readUInt32LE(offset + 16);
              offset += 20;
              frames.push({
                fn:   this.strings.get(funcPtr)  ?? `0x${funcPtr.toString(16)}`,
                file: this.strings.get(filePtr)  ?? `0x${filePtr.toString(16)}`,
                line,
              });
            }
            this.callstacks.set(ptr, frames);
            break;
          }

          default:
            // Unknown event type, skip it
            // Most events are small (< 32 bytes)
            offset = Math.min(offset + 16, data.length);
            break;
        }
      } catch (e) {
        // Parsing error, try to recover
        offset = Math.min(startOffset + 16, data.length);
      }
    }

    return this.getStats();
  }

  // Add a memory allocation
  private addAllocation(ptr: bigint, size: number, time: bigint, thread: number): void {
    // Remove previous allocation at same address if exists
    const existing = this.allocations.get(ptr);
    if (existing && !existing.freed) {
      // Double alloc or realloc without proper free - mark old as freed
      existing.freed = true;
      this.freeCount++;
      this.totalFreed += existing.size;
    }

    const alloc: MemoryAllocation = {
      address: ptr,
      size,
      timestamp: time,
      allocated: true,
      freed: false,
      thread
    };

    this.allocations.set(ptr, alloc);
    this.allocationsByTime.push(alloc);
    this.allocCount++;
    this.totalAllocated += size;

    // Update peak usage
    const currentUsage = this.totalAllocated - this.totalFreed;
    if (currentUsage > this.peakUsage) {
      this.peakUsage = currentUsage;
    }
  }

  // Add a memory free
  private addFree(ptr: bigint, time: bigint, thread: number): void {
    const alloc = this.allocations.get(ptr);
    if (alloc && !alloc.freed) {
      alloc.freed = true;
      this.freeCount++;
      this.totalFreed += alloc.size;
    }
    // If no matching alloc, this might be a free of memory we didn't track
    // (e.g., allocated before profiling started)
  }

  // Get memory statistics
  private getStats(): MemoryStats {
    const leaks: MemoryAllocation[] = [];

    // Find all allocations that were never freed
    for (const alloc of this.allocations.values()) {
      if (alloc.allocated && !alloc.freed) {
        leaks.push({ ...alloc, leaked: true });
      }
    }

    for (const leak of leaks) {
      const cs = this.callstacks.get(leak.address);
      if (cs) leak.callstack = cs;
    }

    const currentUsage = this.totalAllocated - this.totalFreed;

    return {
      totalAllocated: this.totalAllocated,
      totalFreed: this.totalFreed,
      currentUsage,
      peakUsage: this.peakUsage,
      allocationCount: this.allocCount,
      freeCount: this.freeCount,
      leaks,
      allocations: Array.from(this.allocations.values())
    };
  }

  // Find memory issues (leaks, high usage, etc.)
  findMemoryIssues(stats: MemoryStats, options: MemoryAnalysisOptions = {}): MemoryIssue[] {
    const issues: MemoryIssue[] = [];
    const {
      maxLeakSize = 1024 * 1024,        // 1KB default
      maxCurrentUsage = 100 * 1024 * 1024, // 100MB default
      maxAllocCount = 10000                 // high allocation threshold
    } = options;

    // Check for leaks
    for (const leak of stats.leaks) {
      if (leak.size > maxLeakSize) {
        issues.push({
          type: 'leak',
          severity: 'high',
          address: leak.address,
          size: leak.size,
          callstack: leak.callstack,
          description: `Memory leak: ${(leak.size / 1024).toFixed(1)}KB at 0x${leak.address.toString(16)}${leak.name ? ` (${leak.name})` : ''}`,
          recommendation: 'Ensure proper deallocation or use smart pointers/RAII'
        });
      }
    }

    // Check for high current usage
    if (stats.currentUsage > maxCurrentUsage) {
      issues.push({
        type: 'high-usage',
        severity: stats.currentUsage > 500 * 1024 * 1024 ? 'high' : 'medium',
        address: 0n,
        size: stats.currentUsage,
        description: `High memory usage: ${(stats.currentUsage / 1024 / 1024).toFixed(1)}MB`,
        recommendation: 'Consider memory pooling, reducing allocation sizes, or investigating memory growth patterns'
      });
    }

    // Check for memory spikes (peak >> current)
    if (stats.peakUsage > stats.currentUsage * 3 && stats.peakUsage > 10 * 1024 * 1024) {
      issues.push({
        type: 'spike',
        severity: 'medium',
        address: 0n,
        size: stats.peakUsage - stats.currentUsage,
        description: `Memory spike detected: peak was ${(stats.peakUsage / 1024 / 1024).toFixed(1)}MB, now ${(stats.currentUsage / 1024 / 1024).toFixed(1)}MB`,
        recommendation: 'Investigate temporary allocations, consider reusing memory or object pooling'
      });
    }

    // Check for high allocation frequency
    if (stats.allocationCount > maxAllocCount) {
      issues.push({
        type: 'high-frequency',
        severity: 'low',
        address: 0n,
        size: stats.allocationCount,
        count: stats.allocationCount,
        description: `High allocation frequency: ${stats.allocationCount.toLocaleString()} allocations detected`,
        recommendation: 'Consider memory pooling, arena allocation, or reducing per-frame allocations'
      });
    }

    // Check for potential fragmentation (many small allocations)
    const smallAllocs = Array.from(this.allocations.values())
      .filter(a => a.size < 1024 && !a.freed)
      .length;

    if (smallAllocs > 1000) {
      const totalSmallLeaked = Array.from(this.allocations.values())
        .filter(a => a.size < 1024 && !a.freed)
        .reduce((sum, a) => sum + a.size, 0);

      if (totalSmallLeaked > 512 * 1024) { // > 512KB in small leaks
        issues.push({
          type: 'fragmentation',
          severity: 'medium',
          address: 0n,
          size: totalSmallLeaked,
          count: smallAllocs,
          description: `Memory fragmentation: ${smallAllocs.toLocaleString()} small allocations (${(totalSmallLeaked / 1024).toFixed(1)}KB)`,
          recommendation: 'Consider using larger allocation blocks, memory pools, or custom allocators for small objects'
        });
      }
    }

    return issues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return b.size - a.size;
    });
  }

  // Format memory issues for display
  formatMemoryIssues(issues: MemoryIssue[]): string {
    if (issues.length === 0) {
      return 'No memory issues found! 🎉\n\nMemory usage looks healthy with no significant leaks detected.';
    }

    let output = `Found ${issues.length} memory issue(s):\n\n`;

    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';

      output += `${icon} #${i + 1}: ${issue.type.toUpperCase()}\n`;
      output += `   ${issue.description}\n`;
      if (issue.callstack && issue.callstack.length > 0) {
        output += `   Callstack:\n`;
        for (const frame of issue.callstack) {
          output += `     ${frame.fn.padEnd(40)}  [${frame.file}:${frame.line}]\n`;
        }
      }
      if (issue.address !== 0n) {
        output += `   Address: 0x${issue.address.toString(16)}\n`;
      }
      if (issue.count !== undefined) {
        output += `   Count: ${issue.count.toLocaleString()}\n`;
      }
      output += `   💡 ${issue.recommendation}\n\n`;
    }

    return output;
  }

  // Format memory statistics
  formatMemoryStats(stats: MemoryStats): string {
    return `Memory Statistics
==================
Total Allocated: ${(stats.totalAllocated / 1024 / 1024).toFixed(2)} MB
Total Freed: ${(stats.totalFreed / 1024 / 1024).toFixed(2)} MB
Current Usage: ${(stats.currentUsage / 1024 / 1024).toFixed(2)} MB
Peak Usage: ${(stats.peakUsage / 1024 / 1024).toFixed(2)} MB
Allocations: ${stats.allocationCount.toLocaleString()}
Frees: ${stats.freeCount.toLocaleString()}
Potential Leaks: ${stats.leaks.length}`;
  }

  // Helper: read int64 from buffer (little endian)
  private readInt64(data: Buffer, offset: number): bigint {
    const low = data.readUInt32LE(offset);
    const high = data.readInt32LE(offset + 4);
    return BigInt(high) * 4294967296n + BigInt(low);
  }

  // Helper: read uint64 from buffer (little endian)
  private readUInt64(data: Buffer, offset: number): bigint {
    const low = data.readUInt32LE(offset);
    const high = data.readUInt32LE(offset + 4);
    return BigInt(high) * 4294967296n + BigInt(low);
  }

  // Helper: skip to end of buffer safely
  private skipToEnd(data: Buffer, offset: number): number {
    return data.length;
  }

  // Set string mappings (for zone names, memory names, etc.)
  setStrings(strings: Map<bigint, string>): void {
    this.strings = strings;
  }
}
