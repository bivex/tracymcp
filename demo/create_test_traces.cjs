#!/usr/bin/env node
/**
 * Create a comprehensive test .tracy file with real CPU and memory events
 * This simulates what a real Tracy trace would contain
 */

const fs = require('fs');
const lz4 = require('lz4');

// Tracy file header (new format)
// TracyHeader: 't', 'r', 253, 'P' + type (0=LZ4) + streams
const header = Buffer.from([
  0x74, 0x72, 0xfd, 0x50, // 't', 'r', 253, 'P' (TracyHeader)
  0x00,                    // type: 0 (LZ4)
  0x01                     // streams: 1
]);

// Create event data with both CPU zones and memory events
function createEventStream() {
  const events = [];

  // Helper to add int64
  const addInt64 = (value) => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(value % 0x100000000, 0);
    buf.writeUInt32LE(Math.floor(value / 0x100000000), 4);
    return buf;
  };

  // Helper to add uint64
  const addUInt64 = (value) => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(value % 0x100000000, 0);
    buf.writeUInt32LE(Math.floor(value / 0x100000000), 4);
    return buf;
  };

  // Helper to add 48-bit size (6 bytes)
  const addSize48 = (size) => {
    const buf = Buffer.alloc(6);
    buf.writeUInt32LE(size % 0x100000000, 0);
    buf.writeUInt16LE(Math.floor(size / 0x100000000), 4);
    return buf;
  };

  let time = 1000000; // Start time (nanoseconds)

  // Add memory allocation events (QueueType.MemAlloc = 25)
  // QueueMemAlloc: time(8) + thread(4) + ptr(8) + size[6]

  // Alloc 1: 10MB - will be a leak
  events.push(Buffer.from([25])); // MemAlloc
  events.push(addInt64(time));     // time
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00])); // thread
  events.push(addUInt64(0x100000000)); // ptr
  events.push(addSize48(10 * 1024 * 1024)); // size: 10MB
  time += 5000000;

  // Alloc 2: 2MB - will be a leak
  events.push(Buffer.from([25])); // MemAlloc
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x20000000)); // ptr
  events.push(addSize48(2 * 1024 * 1024)); // size: 2MB
  time += 2000000;

  // Alloc 3: 100KB - will be freed
  events.push(Buffer.from([25])); // MemAlloc
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x30000000)); // ptr
  events.push(addSize48(100 * 1024)); // size: 100KB
  time += 3000000;

  // Free alloc 3 (QueueType.MemFree = 27)
  // QueueMemFree: time(8) + thread(4) + ptr(8)
  events.push(Buffer.from([27])); // MemFree
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x30000000)); // same ptr
  time += 1000000;

  // Alloc 4: 1MB - will be freed
  events.push(Buffer.from([25])); // MemAlloc
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x40000000));
  events.push(addSize48(1024 * 1024)); // 1MB
  time += 4000000;

  // Free alloc 4
  events.push(Buffer.from([27])); // MemFree
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x40000000));
  time += 1000000;

  // Small allocations (for fragmentation testing)
  for (let i = 0; i < 20; i++) {
    const ptr = 0x50000000n + BigInt(i);
    events.push(Buffer.from([25])); // MemAlloc
    events.push(addInt64(time));
    events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
    events.push(addUInt64(Number(ptr)));
    events.push(addSize48(64)); // 64 bytes
    time += 50000;
  }

  // Free all small allocs
  for (let i = 0; i < 20; i++) {
    const ptr = 0x50000000n + BigInt(i);
    events.push(Buffer.from([27])); // MemFree
    events.push(addInt64(time));
    events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
    events.push(addUInt64(Number(ptr)));
    time += 50000;
  }

  // Alloc 5: 20MB - temporary (memory spike)
  events.push(Buffer.from([25])); // MemAlloc
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x60000000));
  events.push(addSize48(20 * 1024 * 1024)); // 20MB
  time += 10000000;

  // Free alloc 5
  events.push(Buffer.from([27])); // MemFree
  events.push(addInt64(time));
  events.push(Buffer.from([0x00, 0x00, 0x00, 0x00]));
  events.push(addUInt64(0x60000000));
  time += 1000000;

  return Buffer.concat(events);
}

// Create the test trace file
function createMemoryTrace() {
  // Create event stream
  const eventData = createEventStream();

  // Pad to block size
  const BLOCK_SIZE = 64 * 1024;
  const padded = Buffer.alloc(BLOCK_SIZE);
  eventData.copy(padded);

  // Compress with LZ4
  const compressed = Buffer.alloc(BLOCK_SIZE);
  const compressedSize = lz4.encodeBlock(padded, compressed);

  const actualCompressed = compressed.subarray(0, compressedSize);

  // Create the trace file
  const output = Buffer.concat([
    header,
    Buffer.from([compressedSize & 0xFF, (compressedSize >> 8) & 0xFF, (compressedSize >> 16) & 0xFF, (compressedSize >> 24) & 0xFF]),
    actualCompressed
  ]);

  const outputPath = 'memory_test.tracy';
  fs.writeFileSync(outputPath, output);

  console.log(`Created memory trace file: ${outputPath}`);
  console.log(`Header: ${header.toString('hex')}`);
  console.log(`Event data size: ${eventData.length} bytes`);
  console.log(`Compressed size: ${compressedSize} bytes`);
  console.log(`Total file size: ${output.length} bytes`);

  return outputPath;
}

// Also create a CPU trace with zones
function createCPUTrace() {
  const events = [];

  const addInt64 = (value) => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(value % 0x100000000, 0);
    buf.writeUInt32LE(Math.floor(value / 0x100000000), 4);
    return buf;
  };

  let time = 5000000;

  // SourceLocation for "heavy_compute"
  // QueueSourceLocation: name(8) + function(8) + file(8) + line(4) + r(1) + g(1) + b(1)
  const srcLocData = Buffer.alloc(31);
  addUInt64(0x1000).copy(srcLocData, 0);  // name ptr (we'll use index)
  addUInt64(0x1001).copy(srcLocData, 8);  // function ptr
  addUInt64(0x1002).copy(srcLocData, 16); // file ptr
  srcLocData.writeUInt32LE(42, 24);       // line
  srcLocData[28] = 255; // r
  srcLocData[29] = 0;   // g
  srcLocData[30] = 0;   // b

  // Add source location event (QueueType.SourceLocation = 74, enum value from TracyQueue.hpp)
  events.push(Buffer.from([74])); // SourceLocation
  events.push(srcLocData);

  // StringData events (QueueType.StringData = 118)
  // Format: [type=118] [uint64 ptr] [null-terminated string]
  const addStringData = (ptr, str) => Buffer.concat([
    Buffer.from([104]),  // QueueType::StringData = 104
    addUInt64(ptr),
    Buffer.from(str + '\0', 'utf8')
  ]);

  events.push(addStringData(0x1000, 'heavy_compute')); // zone name
  events.push(addStringData(0x1001, 'heavy_compute')); // function name
  events.push(addStringData(0x1002, 'demo.c'));        // file name

  // ZoneBegin (QueueType.ZoneBegin = 15)
  // QueueZoneBegin: time(8) + srcloc(8)
  events.push(Buffer.from([15])); // ZoneBegin
  events.push(addInt64(time));
  events.push(addUInt64(0)); // srcloc index

  // ZoneEnd (QueueType.ZoneEnd = 17)
  // QueueZoneEnd: time(8)
  const duration = 55 * 1000000; // 55ms
  time += duration;
  events.push(Buffer.from([17])); // ZoneEnd
  events.push(addInt64(time));

  const cpuEvents = Buffer.concat(events);

  // Create the CPU trace file
  const BLOCK_SIZE = 64 * 1024;
  const padded = Buffer.alloc(BLOCK_SIZE);
  cpuEvents.copy(padded);

  const compressed = Buffer.alloc(BLOCK_SIZE);
  const compressedSize = lz4.encodeBlock(padded, compressed);
  const actualCompressed = compressed.subarray(0, compressedSize);

  const output = Buffer.concat([
    header,
    Buffer.from([compressedSize & 0xFF, (compressedSize >> 8) & 0xFF, (compressedSize >> 16) & 0xFF, (compressedSize >> 24) & 0xFF]),
    actualCompressed
  ]);

  fs.writeFileSync('cpu_test.tracy', output);
  console.log(`Created CPU trace file: cpu_test.tracy`);
}

const addUInt64 = (value) => {
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(value % 0x100000000, 0);
  buf.writeUInt32LE(Math.floor(value / 0x100000000), 4);
  return buf;
};

createMemoryTrace();
createCPUTrace();

console.log('\nTest traces created successfully!');
console.log('Use with MCP server:');
console.log('  get_memory_stats(path="memory_test.tracy")');
console.log('  find_memory_leaks(path="memory_test.tracy")');
console.log('  find_problematic_zones(path="cpu_test.tracy")');
