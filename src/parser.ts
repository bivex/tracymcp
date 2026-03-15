/**
 * Full Tracy Trace Parser
 * Parses Tracy .tracy files to extract real timing data
 *
 * For real Tracy save files (produced by tracy-capture), delegates to tracy-csvexport.
 * For synthetic test traces (raw event streams), uses the built-in binary parser.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Path to tracy-csvexport binary (relative to this package)
const CSVEXPORT_BINARY = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../csvexport/build/tracy-csvexport'
);

// Tracy file header - new format
const TRACY_FILE_HEADER = [0x74, 0x72, 0xfd, 0x50]; // 't', 'r', 253, 'P'

// Queue types from TracyQueue.hpp (QueueType enum, 0-based)
const enum QueueType {
  ZoneText = 0,
  ZoneName = 1,
  ZoneBegin = 15,
  ZoneBeginCallstack = 16,
  ZoneEnd = 17,
  ThreadContext = 62,
  ZoneValidation = 67,
  ZoneColor = 68,
  FrameMarkMsg = 70,
  FrameMarkMsgStart = 71,
  FrameMarkMsgEnd = 72,
  SourceLocation = 74,
  SingleStringData = 99,
  SecondStringData = 100,
  StringData = 104,
}

// Source location structure (from QueueSourceLocation)
interface SourceLocation {
  name: bigint;      // pointer to string
  function: bigint;  // pointer to string
  file: bigint;      // pointer to string
  line: number;
  r: number;
  g: number;
  b: number;
}

// Zone begin event
interface ZoneBegin {
  time: bigint;
  srcloc: bigint;    // pointer or index
}

// Zone end event
interface ZoneEnd {
  time: bigint;
}

// Zone timing data
export interface ZoneTiming {
  name: string;
  file?: string;
  function?: string;
  line?: number;
  count: number;
  totalTime: number;      // nanoseconds
  minTime: number;
  maxTime: number;
  avgTime: number;
  variance: number;
  // Optional per-call data (from -u unwrap mode), sorted ascending
  callTimes?: number[];
  // Percentiles computed from callTimes
  p50?: number;
  p90?: number;
  p99?: number;
}

// Active zone for matching begin/end
interface ActiveZone {
  beginTime: bigint;
  srcloc: bigint;
  depth: number;
  customName?: string;  // set by ZoneName / ZoneText events
}

export class TracyTraceParser {
  private strings: Map<bigint, string> = new Map();
  private sourceLocations: Map<bigint, SourceLocation> = new Map();
  private zoneTimings: Map<string, ZoneTiming> = new Map();
  private activeZones: Map<number, ActiveZone[]> = new Map(); // thread -> zones
  private lastSrcLoc: bigint = 0n;

  // Parse a trace file and extract zone timings
  async parseFile(filePath: string): Promise<Map<string, ZoneTiming>> {
    // Real Tracy save files (produced by tracy-capture) use a different format
    // than the raw event stream used by synthetic test traces.
    // Detect by checking if the first decompressed block starts with "tracy\0".
    if (await this.isRealTracySaveFile(filePath)) {
      return this.parseWithCsvExport(filePath);
    }

    const reader = await this.openTraceFile(filePath);
    if (!reader) {
      throw new Error('Failed to open trace file');
    }

    // Read and parse all data blocks
    let offset = reader.dataOffset;
    while (offset < reader.fileSize) {
      // Read block size
      const blockSizeBuf = Buffer.alloc(4);
      fs.readSync(reader.fd, blockSizeBuf, 0, 4, offset);
      const blockSize = blockSizeBuf.readUInt32LE(0);
      offset += 4;

      if (blockSize === 0 || offset + blockSize > reader.fileSize) {
        break;
      }

      // Read and decompress block
      const compressedData = Buffer.alloc(blockSize);
      fs.readSync(reader.fd, compressedData, 0, blockSize, offset);
      offset += blockSize;

      const decompressed = await this.decompressBlock(compressedData, reader.compressionType);
      if (decompressed) {
        this.parseEventStream(decompressed);
      }
    }

    fs.closeSync(reader.fd);
    return this.zoneTimings;
  }

  // Detect whether this is a real Tracy save file (vs a synthetic test trace)
  private async isRealTracySaveFile(filePath: string): Promise<boolean> {
    try {
      const reader = await this.openTraceFile(filePath);
      if (!reader) return false;

      const blockSizeBuf = Buffer.alloc(4);
      fs.readSync(reader.fd, blockSizeBuf, 0, 4, reader.dataOffset);
      const blockSize = blockSizeBuf.readUInt32LE(0);

      if (blockSize === 0 || reader.dataOffset + 4 + blockSize > reader.fileSize) {
        fs.closeSync(reader.fd);
        return false;
      }

      const compressedData = Buffer.alloc(Math.min(blockSize, 512 * 1024));
      fs.readSync(reader.fd, compressedData, 0, compressedData.length, reader.dataOffset + 4);
      fs.closeSync(reader.fd);

      const decompressed = await this.decompressBlock(compressedData, reader.compressionType).catch(() => null);
      if (!decompressed || decompressed.length < 6) return false;

      // Real Tracy save files start with "tracy\0" after decompression
      return decompressed[0] === 0x74 && decompressed[1] === 0x72 &&
             decompressed[2] === 0x61 && decompressed[3] === 0x63 &&
             decompressed[4] === 0x79 && decompressed[5] === 0x00;
    } catch {
      return false;
    }
  }

  // Parse using tracy-csvexport binary (for real Tracy save files)
  private runCsvExport(filePath: string, extraArgs: string[] = []): string {
    if (!fs.existsSync(CSVEXPORT_BINARY)) {
      throw new Error(`tracy-csvexport not found at ${CSVEXPORT_BINARY}. Build it with: cd csvexport && cmake -S . -B build && cmake --build build`);
    }

    const result = spawnSync(CSVEXPORT_BINARY, [...extraArgs, filePath], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    });

    if (result.status !== 0 || !result.stdout) {
      throw new Error(`tracy-csvexport failed: ${result.stderr || 'unknown error'}`);
    }

    return result.stdout;
  }

  private parseWithCsvExport(filePath: string): Map<string, ZoneTiming> {
    // Run aggregated stats export
    const aggregatedCsv = this.runCsvExport(filePath);
    const zones = this.parseCsvOutput(aggregatedCsv);

    // Also run per-call export to compute percentiles (for zones with many calls)
    try {
      const unwrapCsv = this.runCsvExport(filePath, ['-u']);
      this.enrichWithPerCallData(zones, unwrapCsv);
    } catch {
      // Per-call data is optional — aggregated stats are enough
    }

    return zones;
  }

  // Parse aggregated CSV: name,src_file,src_line,total_ns,total_perc,counts,mean_ns,min_ns,max_ns,std_ns
  private parseCsvOutput(csv: string): Map<string, ZoneTiming> {
    const zones = new Map<string, ZoneTiming>();
    const lines = csv.trim().split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',');
      if (parts.length < 10) continue;

      const name = parts[0];
      const srcFile = parts[1];
      const srcLine = parseInt(parts[2], 10);
      const totalNs = parseInt(parts[3], 10);
      const counts = parseInt(parts[5], 10);
      const meanNs = parseInt(parts[6], 10);
      const minNs = parseInt(parts[7], 10);
      const maxNs = parseInt(parts[8], 10);
      const stdNs = parseFloat(parts[9]);

      if (isNaN(totalNs) || isNaN(counts) || counts === 0) continue;

      const key = `${name}@${srcFile}:${srcLine}`;
      zones.set(key, {
        name,
        file: srcFile,
        line: srcLine,
        count: counts,
        totalTime: totalNs,
        minTime: minNs,
        maxTime: maxNs,
        avgTime: meanNs,
        variance: stdNs * stdNs * counts,
      });
    }

    return zones;
  }

  // Enrich zones with per-call times and percentiles from -u unwrap output
  // Unwrap CSV: name,src_file,src_line,ns_since_start,exec_time_ns,thread
  private enrichWithPerCallData(zones: Map<string, ZoneTiming>, csv: string): void {
    // Collect per-call times keyed by "name@file:line"
    const callTimes = new Map<string, number[]>();
    const lines = csv.trim().split('\n');

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].trim().split(',');
      if (parts.length < 5) continue;

      const key = `${parts[0]}@${parts[1]}:${parts[2]}`;
      const execNs = parseInt(parts[4], 10);
      if (isNaN(execNs)) continue;

      if (!callTimes.has(key)) callTimes.set(key, []);
      callTimes.get(key)!.push(execNs);
    }

    // Attach sorted call times and compute percentiles
    for (const [key, zone] of zones) {
      const times = callTimes.get(key);
      if (!times || times.length < 2) continue;

      times.sort((a, b) => a - b);
      zone.callTimes = times;
      zone.p50 = times[Math.floor(times.length * 0.50)];
      zone.p90 = times[Math.floor(times.length * 0.90)];
      zone.p99 = times[Math.floor(times.length * 0.99)];
    }
  }

  // Open and read trace file header
  private async openTraceFile(filePath: string): Promise<{
    fd: number;
    fileSize: number;
    dataOffset: number;
    compressionType: number;
  } | null> {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const fileSize = stats.size;

    // Read header
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);

    // Check for new Tracy format ('t', 'r', 253, 'P' + type + streams)
    if (header[0] === TRACY_FILE_HEADER[0] &&
        header[1] === TRACY_FILE_HEADER[1] &&
        header[2] === TRACY_FILE_HEADER[2] &&
        header[3] === TRACY_FILE_HEADER[3]) {
      // New format: 4 bytes header + type (1 byte) + streams (1 byte)
      const compressionType = header[4];
      // header[5] = streams count, handled by tracy-csvexport for real save files

      return {
        fd,
        fileSize,
        dataOffset: 6,
        compressionType
      };
    }

    // Check for legacy headers
    const legacyLz4 = [0x74, 0x6c, 0x5a, 0x04];
    const legacyZstd = [0x74, 0x5a, 0x73, 0x74];

    if (header[0] === legacyLz4[0] && header[1] === legacyLz4[1] &&
        header[2] === legacyLz4[2] && header[3] === legacyLz4[3]) {
      return {
        fd,
        fileSize,
        dataOffset: 4,
        compressionType: 0 // LZ4
      };
    }

    if (header[0] === legacyZstd[0] && header[1] === legacyZstd[1] &&
        header[2] === legacyZstd[2] && header[3] === legacyZstd[3]) {
      return {
        fd,
        fileSize,
        dataOffset: 4,
        compressionType: 1 // Zstd
      };
    }

    fs.closeSync(fd);
    return null;
  }

  // Decompress a data block
  private async decompressBlock(data: Buffer, compressionType: number): Promise<Buffer> {
    const lz4 = await import('lz4');
    const zstd = await import('@mongodb-js/zstd');

    if (compressionType === 0) {
      // LZ4
      const output = Buffer.alloc(64 * 1024);
      const size = lz4.decodeBlock(data, output);
      if (size < 0) {
        throw new Error('LZ4 decompression failed');
      }
      return output.subarray(0, size);
    } else {
      // Zstd
      const decompressed = await zstd.decompress(data);
      return Buffer.from(decompressed);
    }
  }

  // Parse the event stream
  private parseEventStream(data: Buffer): void {
    let offset = 0;

    while (offset < data.length - 8) {
      // Read event type (uint8)
      const eventType = data[offset];
      offset++;

      try {
        switch (eventType) {
          case QueueType.ZoneBegin:
            offset = this.handleZoneBegin(data, offset, 0);
            break;
          case QueueType.ZoneBeginCallstack:
            offset = this.handleZoneBegin(data, offset, 1);
            break;
          case QueueType.ZoneEnd:
            offset = this.handleZoneEnd(data, offset, 0);
            break;
          case QueueType.SourceLocation:
            offset = this.handleSourceLocation(data, offset);
            break;
          case QueueType.StringData:
          case QueueType.SingleStringData:
          case QueueType.SecondStringData:
            offset = this.handleStringData(data, offset, eventType);
            break;
          case QueueType.ZoneText:
            offset = this.handleZoneText(data, offset);
            break;
          case QueueType.ZoneName:
            offset = this.handleZoneName(data, offset);
            break;
          case QueueType.ZoneColor:
            offset = this.skipBytes(data, offset, 3);
            break;
          case QueueType.FrameMarkMsg:
          case QueueType.FrameMarkMsgStart:
          case QueueType.FrameMarkMsgEnd:
            offset = this.skipBytes(data, offset, 8 + 8);
            break;
          case QueueType.ThreadContext:
            offset = this.skipBytes(data, offset, 4);
            break;
          default:
            // Unknown event type, skip it
            // Most events are small (< 32 bytes)
            offset = Math.min(offset + 16, data.length);
            break;
        }
      } catch (e) {
        // Parsing error, skip to next event
        offset = Math.min(offset + 16, data.length);
      }
    }
  }

  // Handle ZoneBegin event
  private handleZoneBegin(data: Buffer, offset: number, hasCallstack: number): number {
    // QueueZoneBegin: int64_t time + uint64_t srcloc
    if (offset + 16 > data.length) return offset;

    const time = this.readInt64(data, offset);
    const srcloc = this.readUInt64(data, offset + 8);

    // Synthetic test traces are single-threaded, so threadId=0 is correct
    const threadId = 0;

    if (!this.activeZones.has(threadId)) {
      this.activeZones.set(threadId, []);
    }

    this.activeZones.get(threadId)!.push({
      beginTime: time,
      srcloc,
      depth: this.activeZones.get(threadId)!.length
    });

    return offset + 16;
  }

  // Handle ZoneEnd event
  private handleZoneEnd(data: Buffer, offset: number, hasThread: number): number {
    // QueueZoneEnd: int64_t time
    if (offset + 8 > data.length) return offset;

    const endTime = this.readInt64(data, offset);
    const threadId = 0;

    const zones = this.activeZones.get(threadId);
    if (!zones || zones.length === 0) {
      return offset + 8;
    }

    // Pop the most recent zone
    const zone = zones.pop()!;

    // Calculate duration
    const duration = Number(endTime - zone.beginTime);

    // Resolve zone name: prefer ZoneName/ZoneText override, then source location name
    const srcLoc = this.sourceLocations.get(zone.srcloc);
    let zoneName = zone.customName ?? `zone_${zone.srcloc.toString(16)}`;

    if (!zone.customName && srcLoc) {
      const nameStr = this.strings.get(srcLoc.name);
      if (nameStr) zoneName = nameStr;
    }

    // Update zone timings
    if (!this.zoneTimings.has(zoneName)) {
      this.zoneTimings.set(zoneName, {
        name: zoneName,
        file: srcLoc ? this.strings.get(srcLoc.file) : undefined,
        function: srcLoc ? this.strings.get(srcLoc.function) : undefined,
        line: srcLoc?.line,
        count: 0,
        totalTime: 0,
        minTime: duration,
        maxTime: duration,
        avgTime: 0,
        variance: 0
      });
    }

    const timing = this.zoneTimings.get(zoneName)!;
    timing.count++;
    timing.totalTime += duration;

    if (duration < timing.minTime) timing.minTime = duration;
    if (duration > timing.maxTime) timing.maxTime = duration;

    // Update average and variance using Welford's method
    const delta = duration - timing.avgTime;
    timing.avgTime += delta / timing.count;
    const delta2 = duration - timing.avgTime;
    timing.variance += delta * delta2;

    return offset + 8;
  }

  // Handle SourceLocation event
  private handleSourceLocation(data: Buffer, offset: number): number {
    // QueueSourceLocation:
    // uint64_t name, uint64_t function, uint64_t file, uint32_t line, uint8_t r, uint8_t g, uint8_t b
    if (offset + 31 > data.length) return offset;

    const name = this.readUInt64(data, offset);
    const func = this.readUInt64(data, offset + 8);
    const file = this.readUInt64(data, offset + 16);
    const line = data.readUInt32LE(offset + 24);
    const r = data[offset + 28];
    const g = data[offset + 29];
    const b = data[offset + 30];

    // Use last source location as key (or generate new one)
    const srcLocId = this.lastSrcLoc++;
    this.sourceLocations.set(srcLocId, {
      name,
      function: func,
      file,
      line,
      r, g, b
    });

    return offset + 31;
  }

  // Handle StringData event: uint64_t ptr + null-terminated string
  private handleStringData(data: Buffer, offset: number, eventType: number): number {
    if (offset + 8 > data.length) return offset;

    const ptr = this.readUInt64(data, offset + 0);

    // Find null-terminated string
    let strEnd = offset + 8;
    while (strEnd < data.length && data[strEnd] !== 0) {
      strEnd++;
    }

    if (strEnd < data.length) {
      const str = data.subarray(offset + 8, strEnd).toString('utf-8');
      this.strings.set(ptr, str);
    }

    return strEnd + 1;
  }

  // Handle ZoneText / ZoneName event: QueueZoneTextFat: uint64_t ptr, uint16_t size, char[] text
  // Applies a custom display name to the innermost active zone.
  private handleZoneText(data: Buffer, offset: number): number {
    if (offset + 10 > data.length) return offset;

    const size = data.readUInt16LE(offset + 8);
    if (offset + 10 + size > data.length) return offset;

    const text = data.subarray(offset + 10, offset + 10 + size).toString('utf-8');

    const zones = this.activeZones.get(0);
    if (zones && zones.length > 0) {
      zones[zones.length - 1].customName = text;
    }

    return offset + 10 + size;
  }

  private handleZoneName(data: Buffer, offset: number): number {
    return this.handleZoneText(data, offset);
  }

  // Skip bytes in the stream
  private skipBytes(data: Buffer, offset: number, count: number): number {
    return Math.min(offset + count, data.length);
  }

  // Read int64 from buffer (little endian)
  private readInt64(data: Buffer, offset: number): bigint {
    const low = data.readUInt32LE(offset);
    const high = data.readInt32LE(offset + 4);
    return BigInt(high) * 4294967296n + BigInt(low);
  }

  // Read uint64 from buffer (little endian)
  private readUInt64(data: Buffer, offset: number): bigint {
    const low = data.readUInt32LE(offset);
    const high = data.readUInt32LE(offset + 4);
    return BigInt(high) * 4294967296n + BigInt(low);
  }
}
