#!/usr/bin/env node
/**
 * Test script for Tracy MCP server
 */

const { TracyReader } = require('../dist/reader.js');
const fs = require('fs');

async function main() {
  const tracePath = 'test.tracy';

  if (!fs.existsSync(tracePath)) {
    console.error(`Error: File not found: ${tracePath}`);
    process.exit(1);
  }

  try {
    console.log('Testing Tracy MCP Server...\n');

    // Test 1: Read trace
    console.log('=== Test 1: Read Trace ===');
    const reader = new TracyReader(tracePath);
    const info = reader.getInfo();
    console.log('File Info:', info);

    const data = await reader.readAllData();
    console.log(`Decompressed size: ${data.length} bytes`);

    const basicInfo = reader.extractBasicInfo(data);
    console.log('Basic Info:', basicInfo);
    reader.close();

    // Test 2: List zones
    console.log('\n=== Test 2: List Zones ===');
    const reader2 = new TracyReader(tracePath);
    const data2 = await reader2.readAllData();
    const zones = reader2.findPotentialZones(data2);
    console.log(`Found ${zones.length} zones:`);
    zones.slice(0, 10).forEach((z, i) => console.log(`  ${i + 1}. ${z.name}`));
    if (zones.length > 10) {
      console.log(`  ...and ${zones.length - 10} more`);
    }
    reader2.close();

    // Test 3: List zones with filter
    console.log('\n=== Test 3: List Zones with Filter "frame" ===');
    const reader3 = new TracyReader(tracePath);
    const data3 = await reader3.readAllData();
    const filteredZones = reader3.findPotentialZones(data3, 'frame');
    console.log(`Found ${filteredZones.length} zones matching "frame":`);
    filteredZones.forEach((z, i) => console.log(`  ${i + 1}. ${z.name}`));
    reader3.close();

    console.log('\n=== All tests passed! ===');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
