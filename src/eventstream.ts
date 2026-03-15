/**
 * Shared event stream parsing utilities for Tracy binary traces.
 * All sizes are PAYLOAD bytes after the type byte.
 */

// SKIP_SIZE[type] = fixed payload bytes after the type byte.
// -1 means variable-length; caller must handle specially.
export const SKIP_SIZE: number[] = [
  0,   // [0]  ZoneText
  0,   // [1]  ZoneName
  9,   // [2]  Message: time(8)+metadata(1)
  12,  // [3]  MessageColor: time(8)+b+g+r+metadata
  9,   // [4]  MessageCallstack
  12,  // [5]  MessageColorCallstack
  8,   // [6]  MessageAppInfo: time(8)
  8,   // [7]  ZoneBeginAllocSrcLoc: time(8)
  8,   // [8]  ZoneBeginAllocSrcLocCallstack
  8,   // [9]  CallstackSerial: ptr(8)
  8,   // [10] Callstack: ptr(8)
  16,  // [11] CallstackAlloc: ptr(8)+nativePtr(8)
  12,  // [12] CallstackSample: time(8)+thread(4)
  12,  // [13] CallstackSampleContextSwitch
  9,   // [14] FrameImage: frame(4)+w(2)+h(2)+flip(1)
  16,  // [15] ZoneBegin: time(8)+srcloc(8)
  16,  // [16] ZoneBeginCallstack
  8,   // [17] ZoneEnd: time(8)
  16,  // [18] LockWait: thread(4)+id(4)+time(8)
  16,  // [19] LockObtain: thread(4)+id(4)+time(8)
  12,  // [20] LockRelease: id(4)+time(8)
  16,  // [21] LockSharedWait
  16,  // [22] LockSharedObtain
  16,  // [23] LockSharedRelease: id(4)+time(8)+thread(4)
  4,   // [24] LockName: id(4)
  26,  // [25] MemAlloc: time(8)+thread(4)+ptr(8)+size(6)
  26,  // [26] MemAllocNamed
  20,  // [27] MemFree: time(8)+thread(4)+ptr(8)
  20,  // [28] MemFreeNamed
  26,  // [29] MemAllocCallstack
  26,  // [30] MemAllocCallstackNamed
  20,  // [31] MemFreeCallstack
  20,  // [32] MemFreeCallstackNamed
  20,  // [33] MemDiscard: time(8)+thread(4)+name(8)
  20,  // [34] MemDiscardCallstack
  23,  // [35] GpuZoneBegin: cpuTime(8)+thread(4)+queryId(2)+context(1)+srcloc(8)
  23,  // [36] GpuZoneBeginCallstack
  15,  // [37] GpuZoneBeginAllocSrcLoc: cpuTime(8)+thread(4)+queryId(2)+context(1)
  15,  // [38] GpuZoneBeginAllocSrcLocCallstack
  15,  // [39] GpuZoneEnd: cpuTime(8)+thread(4)+queryId(2)+context(1)
  23,  // [40] GpuZoneBeginSerial
  23,  // [41] GpuZoneBeginCallstackSerial
  15,  // [42] GpuZoneBeginAllocSrcLocSerial
  15,  // [43] GpuZoneBeginAllocSrcLocCallstackSerial
  15,  // [44] GpuZoneEndSerial
  24,  // [45] PlotDataInt: name(8)+time(8)+val(8)
  20,  // [46] PlotDataFloat: name(8)+time(8)+val(4)
  24,  // [47] PlotDataDouble: name(8)+time(8)+val(8)
  22,  // [48] ContextSwitch
  15,  // [49] ThreadWakeup
  11,  // [50] GpuTime: gpuTime(8)+queryId(2)+context(1)
  1,   // [51] GpuContextName: context(1)
  9,   // [52] GpuAnnotationName: noteId(8)+context(1)
  9,   // [53] CallstackFrameSize: ptr(8)+size(1)
  12,  // [54] SymbolInformation: line(4)+symAddr(8)
  0,   // [55] ExternalNameMetadata (not wire)
  0,   // [56] SymbolCodeMetadata (not wire)
  0,   // [57] SourceCodeMetadata (not wire)
  24,  // [58] FiberEnter: time(8)+fiber(8)+thread(4)+groupHint(4)
  12,  // [59] FiberLeave: time(8)+thread(4)
  0,   // [60] Terminate
  0,   // [61] KeepAlive
  4,   // [62] ThreadContext: thread(4)
  25,  // [63] GpuCalibration: gpuTime(8)+cpuTime(8)+cpuDelta(8)+context(1)
  17,  // [64] GpuTimeSync: gpuTime(8)+cpuTime(8)+context(1)
  0,   // [65] Crash
  16,  // [66] CrashReport: time(8)+text(8)
  4,   // [67] ZoneValidation: id(4)
  3,   // [68] ZoneColor: b+g+r
  8,   // [69] ZoneValue: value(8)
  16,  // [70] FrameMarkMsg: time(8)+name(8)
  16,  // [71] FrameMarkMsgStart
  16,  // [72] FrameMarkMsgEnd
  12,  // [73] FrameVsync: time(8)+id(4)
  31,  // [74] SourceLocation: name(8)+func(8)+file(8)+line(4)+b+g+r
  21,  // [75] LockAnnounce: id(4)+time(8)+lckloc(8)+type(1)
  12,  // [76] LockTerminate: id(4)+time(8)
  16,  // [77] LockMark: thread(4)+id(4)+srcloc(8)
  16,  // [78] MessageLiteral: time(8)+textAndMetadata(8)
  19,  // [79] MessageLiteralColor: time(8)+b+g+r+textAndMetadata(8)
  16,  // [80] MessageLiteralCallstack
  19,  // [81] MessageLiteralColorCallstack
  27,  // [82] GpuNewContext: cpuTime(8)+gpuTime(8)+thread(4)+period(4)+context(1)+flags(1)+type(1)
  16,  // [83] CallstackFrame: line(4)+symAddr(8)+symLen(4)
  12,  // [84] SysTimeReport: time(8)+sysTime(4)
  24,  // [85] SysPowerReport: time(8)+delta(8)+name(8)
  16,  // [86] TidToPid: tid(8)+pid(8)
  16,  // [87] HwSampleCpuCycle: ip(8)+time(8)
  16,  // [88] HwSampleInstructionRetired
  16,  // [89] HwSampleCacheReference
  16,  // [90] HwSampleCacheMiss
  16,  // [91] HwSampleBranchRetired
  16,  // [92] HwSampleBranchMiss
  15,  // [93] PlotConfig: name(8)+type(1)+step(1)+fill(1)+color(4)
  17,  // [94] ParamSetup: idx(4)+name(8)+isBool(1)+val(4)
  0,   // [95] AckServerQueryNoop
  4,   // [96] AckSourceCodeNotAvailable: id(4)
  0,   // [97] AckSymbolCodeNotAvailable
  16,  // [98] CpuTopology: package(4)+die(4)+core(4)+thread(4)
  -1,  // [99]  SingleStringData: variable (no ptr, just string+NUL)
  -1,  // [100] SecondStringData: variable (no ptr, just string+NUL)
  8,   // [101] MemNamePayload: name(8)
  8,   // [102] ThreadGroupHint: thread(4)+groupHint(4)
  23,  // [103] GpuZoneAnnotation: noteId(8)+value(8)+thread(4)+queryId(2)+context(1)
  -1,  // [104] StringData: ptr(8) + string + NUL
  -1,  // [105] ThreadName: ptr(8) + string + NUL
  -1,  // [106] PlotName: ptr(8) + string + NUL
  -1,  // [107] SourceLocationPayload: ptr(8) + string + NUL
  -1,  // [108] CallstackPayload: ptr(8) + variable
  -1,  // [109] CallstackAllocPayload: ptr(8) + variable
  -1,  // [110] FrameName: ptr(8) + string + NUL
  -1,  // [111] FrameImageData: ptr(8) + variable
  -1,  // [112] ExternalName: ptr(8) + string + NUL
  -1,  // [113] ExternalThreadName: ptr(8) + string + NUL
  -1,  // [114] SymbolCode: variable
  -1,  // [115] SourceCode: variable
  -1,  // [116] FiberName: ptr(8) + string + NUL
];

// String-carrying variable-length types (have ptr(8) prefix then NUL-terminated string)
const STRING_PTR_TYPES = new Set([104, 105, 106, 107, 110, 112, 113, 116]);

// Variable types without ptr (99=SingleStringData, 100=SecondStringData)
const STRING_NO_PTR_TYPES = new Set([99, 100]);

export function readI64(buf: Buffer, off: number): bigint {
  return BigInt(buf.readInt32LE(off + 4)) * 4294967296n + BigInt(buf.readUInt32LE(off));
}

export function readU64(buf: Buffer, off: number): bigint {
  return BigInt(buf.readUInt32LE(off + 4)) * 4294967296n + BigInt(buf.readUInt32LE(off));
}

export function toMs(ns: bigint | number): number {
  return Number(ns) / 1_000_000;
}

/**
 * Skip past one event's payload starting at offset (type byte already consumed).
 * Returns new offset after the event.
 */
export function skipEvent(data: Buffer, offset: number, type: number): number {
  if (type >= SKIP_SIZE.length) {
    // Unknown type: conservative skip
    return Math.min(offset + 16, data.length);
  }
  const sz = SKIP_SIZE[type];
  if (sz >= 0) {
    return Math.min(offset + sz, data.length);
  }

  // Variable-length event
  if (STRING_NO_PTR_TYPES.has(type)) {
    // No ptr prefix — scan directly for NUL
    let pos = offset;
    while (pos < data.length && data[pos] !== 0) pos++;
    return Math.min(pos + 1, data.length);
  }

  if (STRING_PTR_TYPES.has(type)) {
    // ptr(8) prefix, then NUL-terminated string
    let pos = offset + 8;
    while (pos < data.length && data[pos] !== 0) pos++;
    return Math.min(pos + 1, data.length);
  }

  // Non-string variable types (callstack payloads 108,109; image data 111; code 114,115)
  // Conservative: just skip the ptr(8)
  return Math.min(offset + 8, data.length);
}

/**
 * Read a string event payload (type byte already consumed).
 * - hasPtr=false: SingleStringData/SecondStringData → string+NUL starts at offset
 * - hasPtr=true:  StringData/ThreadName/PlotName/etc → ptr(8) then string+NUL
 */
export function readStringPayload(
  data: Buffer,
  offset: number,
  hasPtr: boolean
): { ptr: bigint; str: string; next: number } {
  const ptr = hasPtr ? readU64(data, offset) : 0n;
  const strStart = offset + (hasPtr ? 8 : 0);
  let pos = strStart;
  while (pos < data.length && data[pos] !== 0) pos++;
  const str = data.subarray(strStart, pos).toString('utf-8');
  return { ptr, str, next: Math.min(pos + 1, data.length) };
}
