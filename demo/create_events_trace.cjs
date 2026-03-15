#!/usr/bin/env node
/**
 * Create a synthetic Tracy trace file with messages, frame marks, plots,
 * lock events, and GPU zone events for testing the new MCP tools.
 */

'use strict';

const fs = require('fs');
const lz4 = require('lz4');

// Tracy file header (new format): 't', 'r', 253, 'P' + type(LZ4=0) + streams(1)
const TRACY_HEADER = Buffer.from([0x74, 0x72, 0xfd, 0x50, 0x00, 0x01]);

// --- Wire helpers -----------------------------------------------------------

function u8(v) {
  const b = Buffer.alloc(1);
  b[0] = v & 0xff;
  return b;
}

function u16LE(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v >>> 0, 0);
  return b;
}

function u32LE(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function u64LE(v) {
  // v may be a number or BigInt
  const b = Buffer.alloc(8);
  const big = typeof v === 'bigint' ? v : BigInt(Math.floor(v));
  b.writeUInt32LE(Number(big & 0xffffffffn), 0);
  b.writeUInt32LE(Number((big >> 32n) & 0xffffffffn), 4);
  return b;
}

function i64LE(v) {
  return u64LE(BigInt(v));
}

function f32LE(v) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v, 0);
  return b;
}

function f64LE(v) {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(v, 0);
  return b;
}

function nullStr(s) {
  return Buffer.from(s + '\0', 'utf8');
}

// --- QueueType constants (from spec) ----------------------------------------
const QT = {
  Message:              2,
  MessageColor:         3,
  ZoneBeginAllocSrcLoc: 7,
  ZoneEnd:              17,
  LockWait:             18,
  LockObtain:           19,
  LockRelease:          20,
  GpuZoneBegin:         35,
  GpuZoneEnd:           39,
  PlotDataDouble:       47,
  GpuTime:              50,
  GpuContextName:       51,
  FrameMarkMsg:         70,
  SourceLocation:       74,
  LockAnnounce:         75,
  LockName:             24,
  MessageLiteral:       78,
  GpuNewContext:        82,
  SingleStringData:     99,
  StringData:           104,
  PlotName:             106,
};

// --- Event builders ---------------------------------------------------------

/** SingleStringData(99): no ptr, just string+NUL */
function singleStringData(str) {
  return Buffer.concat([u8(QT.SingleStringData), nullStr(str)]);
}

/** StringData(104): ptr(8) + string+NUL */
function stringData(ptr, str) {
  return Buffer.concat([u8(QT.StringData), u64LE(ptr), nullStr(str)]);
}

/** PlotName(106): ptr(8) + string+NUL */
function plotName(ptr, str) {
  return Buffer.concat([u8(QT.PlotName), u64LE(ptr), nullStr(str)]);
}

/**
 * Message(2): time(8)+metadata(1)
 * severity index in upper nibble (0=Trace,1=Debug,2=Info,3=Warning,4=Error,5=Fatal)
 * source in lower nibble (0=User,1=Tracy)
 * Preceded by SingleStringData with the message text.
 */
function message(timeNs, text, severityIdx, source = 0) {
  const meta = ((severityIdx & 0x0f) << 4) | (source & 0x0f);
  return Buffer.concat([
    singleStringData(text),
    u8(QT.Message),
    i64LE(timeNs),
    u8(meta),
  ]);
}

/**
 * FrameMarkMsg(70): time(8)+namePtr(8)
 * namePtr=0 → default "Frame" group
 */
function frameMarkMsg(timeNs, namePtr = 0) {
  return Buffer.concat([u8(QT.FrameMarkMsg), i64LE(timeNs), u64LE(namePtr)]);
}

/**
 * PlotName(106) then PlotDataDouble(47): namePtr(8)+time(8)+val(double 8)
 */
function plotDataDouble(namePtr, timeNs, val) {
  return Buffer.concat([
    u8(QT.PlotDataDouble),
    u64LE(namePtr),
    i64LE(timeNs),
    f64LE(val),
  ]);
}

/**
 * LockAnnounce(75): id(4)+time(8)+lckloc(8)+type(1) = 21 bytes
 */
function lockAnnounce(id, timeNs) {
  return Buffer.concat([
    u8(QT.LockAnnounce),
    u32LE(id),
    i64LE(timeNs),
    u64LE(0), // lckloc = 0
    u8(0),    // type = mutex
  ]);
}

/**
 * LockName(24): preceded by SingleStringData; id(4) = 4 bytes
 */
function lockName(id, name) {
  return Buffer.concat([
    singleStringData(name),
    u8(QT.LockName),
    u32LE(id),
  ]);
}

/**
 * LockWait(18): thread(4)+id(4)+time(8) = 16 bytes
 */
function lockWait(threadId, lockId, timeNs) {
  return Buffer.concat([u8(QT.LockWait), u32LE(threadId), u32LE(lockId), i64LE(timeNs)]);
}

/**
 * LockObtain(19): thread(4)+id(4)+time(8) = 16 bytes
 */
function lockObtain(threadId, lockId, timeNs) {
  return Buffer.concat([u8(QT.LockObtain), u32LE(threadId), u32LE(lockId), i64LE(timeNs)]);
}

/**
 * LockRelease(20): id(4)+time(8) = 12 bytes
 */
function lockRelease(lockId, timeNs) {
  return Buffer.concat([u8(QT.LockRelease), u32LE(lockId), i64LE(timeNs)]);
}

/**
 * SourceLocation(74): name(8)+func(8)+file(8)+line(4)+r+g+b = 31 bytes
 */
function sourceLocation(namePtr, funcPtr, filePtr, line, r = 255, g = 0, b = 0) {
  return Buffer.concat([
    u8(QT.SourceLocation),
    u64LE(namePtr),
    u64LE(funcPtr),
    u64LE(filePtr),
    u32LE(line),
    u8(r), u8(g), u8(b),
  ]);
}

/**
 * GpuNewContext(82): cpuTime(8)+gpuTime(8)+thread(4)+period(4)+context(1)+flags(1)+type(1) = 27 bytes
 */
function gpuNewContext(cpuTimeNs, gpuTimeNs, threadId, context = 0) {
  // period as float LE (nanoseconds per tick), e.g., 1.0 ns/tick
  const periodBuf = Buffer.alloc(4);
  periodBuf.writeFloatLE(1.0, 0);
  return Buffer.concat([
    u8(QT.GpuNewContext),
    i64LE(cpuTimeNs),
    i64LE(gpuTimeNs),
    u32LE(threadId),
    periodBuf,
    u8(context),
    u8(0), // flags
    u8(0), // type (OpenGL=0)
  ]);
}

/**
 * GpuZoneBegin(35): cpuTime(8)+thread(4)+queryId(2)+context(1)+srcloc(8) = 23 bytes
 */
function gpuZoneBegin(cpuTimeNs, threadId, queryId, context, srclocPtr) {
  return Buffer.concat([
    u8(QT.GpuZoneBegin),
    i64LE(cpuTimeNs),
    u32LE(threadId),
    u16LE(queryId),
    u8(context),
    u64LE(srclocPtr),
  ]);
}

/**
 * GpuZoneEnd(39): cpuTime(8)+thread(4)+queryId(2)+context(1) = 15 bytes
 */
function gpuZoneEnd(cpuTimeNs, threadId, queryId, context) {
  return Buffer.concat([
    u8(QT.GpuZoneEnd),
    i64LE(cpuTimeNs),
    u32LE(threadId),
    u16LE(queryId),
    u8(context),
  ]);
}

/**
 * GpuTime(50): gpuTime(8)+queryId(2)+context(1) = 11 bytes
 */
function gpuTime(gpuTimeNs, queryId, context) {
  return Buffer.concat([
    u8(QT.GpuTime),
    i64LE(gpuTimeNs),
    u16LE(queryId),
    u8(context),
  ]);
}

// --- Build the event stream -------------------------------------------------

function buildEventStream() {
  const parts = [];
  let t = 1_000_000n; // start at 1ms (nanoseconds)

  const MS = 1_000_000n; // 1ms in ns

  // ---- Messages (5 messages at different severities) ----
  // severityIdx: 0=Trace,1=Debug,2=Info,3=Warning,4=Error,5=Fatal

  // Info message
  parts.push(message(t, 'Application started', 2));
  t += 5n * MS;

  // Info message
  parts.push(message(t, 'Loading assets...', 2));
  t += 10n * MS;

  // Warning message
  parts.push(message(t, 'Texture size exceeds recommended limit', 3));
  t += 5n * MS;

  // Error message
  parts.push(message(t, 'Failed to load shader: missing uniform', 4));
  t += 5n * MS;

  // Info message
  parts.push(message(t, 'Initialization complete', 2));
  t += 5n * MS;

  // ---- Frame marks (3 frames, ~16ms apart, then one spike at 50ms) ----
  // Default frame group (namePtr=0)
  const frame0 = t;
  t += 16n * MS; // 16ms frame
  parts.push(frameMarkMsg(t, 0n));

  t += 16n * MS; // another 16ms frame
  parts.push(frameMarkMsg(t, 0n));

  t += 50n * MS; // spike frame (50ms)
  parts.push(frameMarkMsg(t, 0n));

  // ---- Plot data (FPS plot) ----
  // StringData for "FPS" name
  const fpsPtrBig = 0x9000n;
  parts.push(plotName(fpsPtrBig, 'FPS'));

  // Two plot data points
  const plotT1 = t;
  t += 10n * MS;
  parts.push(plotDataDouble(fpsPtrBig, plotT1, 62.5));

  const plotT2 = t;
  t += 10n * MS;
  parts.push(plotDataDouble(fpsPtrBig, plotT2, 20.0)); // low fps sample

  // ---- Lock contention ----
  // LockAnnounce first
  const lockId = 42;
  const thread1 = 1;
  const thread2 = 2;

  parts.push(lockAnnounce(lockId, t));
  parts.push(lockName(lockId, 'RenderMutex'));

  // Thread 1 waits and obtains immediately (no contention)
  const t1WaitStart = t;
  t += 1n * MS;
  parts.push(lockWait(thread1, lockId, t1WaitStart));
  parts.push(lockObtain(thread1, lockId, t));

  // Thread 2 waits while thread 1 holds — contention!
  const t2WaitStart = t;
  t += 2n * MS;
  parts.push(lockWait(thread2, lockId, t2WaitStart));

  // Thread 1 releases after 5ms total hold
  t += 5n * MS;
  parts.push(lockRelease(lockId, t));

  // Thread 2 obtains (waited ~7ms total)
  parts.push(lockObtain(thread2, lockId, t));
  t += 3n * MS;
  parts.push(lockRelease(lockId, t));

  // ---- GPU zone ----
  const gpuContext = 0;
  const gpuThread = 1;
  const cpuBase = t;
  const gpuBase = t;

  // Register GPU context
  parts.push(gpuNewContext(cpuBase, gpuBase, gpuThread, gpuContext));

  // StringData for zone name
  const zoneNamePtr = 0xa000n;
  const zoneFuncPtr = 0xa001n;
  const zoneFilePtr = 0xa002n;
  parts.push(stringData(zoneNamePtr, 'DrawScene'));
  parts.push(stringData(zoneFuncPtr, 'DrawScene'));
  parts.push(stringData(zoneFilePtr, 'renderer.cpp'));

  // SourceLocation (index 0)
  parts.push(sourceLocation(zoneNamePtr, zoneFuncPtr, zoneFilePtr, 100));

  // GPU zone begin (queryId=1 for begin, queryId=2 for end)
  const gpuCpuBegin = t;
  t += 8n * MS;
  const gpuCpuEnd = t;

  parts.push(gpuZoneBegin(gpuCpuBegin, gpuThread, 1, gpuContext, 0n)); // srclocPtr=0 → sourceLocs[0]
  // GpuTime for begin query
  parts.push(gpuTime(gpuCpuBegin, 1, gpuContext));

  parts.push(gpuZoneEnd(gpuCpuEnd, gpuThread, 1, gpuContext));
  // GpuTime for end query
  parts.push(gpuTime(gpuCpuEnd, 1, gpuContext));

  t += 5n * MS;

  return Buffer.concat(parts);
}

// --- Compress and write file ------------------------------------------------

function writeTraceFile(outputPath) {
  const eventData = buildEventStream();

  // Pad to at least blockSize for lz4
  const BLOCK_SIZE = 64 * 1024;
  const paddedSize = Math.max(eventData.length, BLOCK_SIZE);
  const padded = Buffer.alloc(paddedSize);
  eventData.copy(padded, 0);

  const compressBuf = Buffer.alloc(paddedSize + 1024);
  const compressedSize = lz4.encodeBlock(padded, compressBuf);
  const compressed = compressBuf.subarray(0, compressedSize);

  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(compressedSize, 0);

  const file = Buffer.concat([TRACY_HEADER, sizeBuf, compressed]);
  fs.writeFileSync(outputPath, file);

  console.log(`Created events trace: ${outputPath}`);
  console.log(`  Event data: ${eventData.length} bytes`);
  console.log(`  Compressed: ${compressedSize} bytes`);
  console.log(`  File size:  ${file.length} bytes`);
}

const outputPath = process.argv[2] || 'demo/events_test.tracy';
writeTraceFile(outputPath);
