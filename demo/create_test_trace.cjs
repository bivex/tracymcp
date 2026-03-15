#!/usr/bin/env node
/**
 * Create a minimal test .tracy file for testing the MCP server
 */

const fs = require('fs');
const lz4 = require('lz4');

// Tracy file header for LZ4 compression
// Format: 't', 'l', 'Z', 4 (magic bytes for LZ4 compressed trace)
const header = Buffer.from([0x74, 0x6c, 0x5a, 0x04]);

// Create some fake zone data that would be in a real trace
const testNames = [
  'main',
  'heavy_work',
  'process_data',
  'initialize',
  'processing_loop',
  'cleanup',
  'fast_operation',
  'memory_demo',
  'database_query',
  'connect',
  'execute_query',
  'fetch_results',
  'frame_0',
  'physics_update',
  'culling',
  'render',
  'present',
  'frame_1',
  'frame_2',
  'frame_3',
  'frame_4',
  'UpdatePhysics',
  'RenderScene',
  'ProcessInput',
  'GameLoop',
  'FrameTick',
  'myFunction',
  'LoadTexture',
  'DrawModel',
  'UpdateAI',
  'ProcessNetwork',
];

// Create test data with null-terminated strings
let testData = Buffer.alloc(64 * 1024); // 64KB block
let offset = 0;

for (const name of testNames) {
  const nameBuf = Buffer.from(name + '\0');
  nameBuf.copy(testData, offset);
  offset += nameBuf.length;
}

// Compress with LZ4
const input = testData.subarray(0, offset);
const output = Buffer.alloc(64 * 1024);
const compressedSize = lz4.encodeBlock(input, output);
const compressed = output.subarray(0, compressedSize);

// Create the trace file
const outputPath = 'test.tracy';
const fileData = Buffer.concat([
  header,
  Buffer.from([compressedSize & 0xFF, (compressedSize >> 8) & 0xFF, (compressedSize >> 16) & 0xFF, (compressedSize >> 24) & 0xFF]),
  compressed
]);

fs.writeFileSync(outputPath, fileData);

console.log(`Created test trace file: ${outputPath}`);
console.log(`Header: ${header.toString('hex')}`);
console.log(`Block size: ${compressedSize} bytes`);
console.log(`Zone names: ${testNames.length}`);
