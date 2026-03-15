#!/usr/bin/env node
/**
 * Test the real Tracy parser
 */

const { TracyAnalyzer } = require('../dist/analyzer.js');

async function main() {
  console.log('Testing Real Tracy Parser\n');

  const analyzer = new TracyAnalyzer();

  try {
    console.log('Parsing test.tracy...\n');
    const zones = await analyzer.parseTrace('test.tracy');

    console.log(`Found ${zones.size} zones\n`);

    if (zones.size === 0) {
      console.log('No zones found - the trace file may be in a format not yet supported.');
      console.log('The parser currently supports basic Tracy traces with ZoneBegin/ZoneEnd events.');
      return;
    }

    console.log('=== All Zone Timings ===');
    for (const [name, zone] of zones) {
      console.log(`${name}:`);
      console.log(`  Calls: ${zone.count}`);
      console.log(`  Total: ${(zone.totalTime / 1_000_000).toFixed(3)}ms`);
      console.log(`  Avg: ${(zone.avgTime / 1_000_000).toFixed(3)}ms`);
      console.log(`  Min: ${(zone.minTime / 1_000_000).toFixed(3)}ms`);
      console.log(`  Max: ${(zone.maxTime / 1_000_000).toFixed(3)}ms`);
      if (zone.function) {
        console.log(`  Function: ${zone.function}`);
        if (zone.file) {
          console.log(`  File: ${zone.file}:${zone.line}`);
        }
      }
      console.log();
    }

    console.log('\n=== Problematic Zones (Default) ===');
    const problematic = analyzer.findProblematicZones(zones);
    console.log(analyzer.formatProblematicZones(problematic));

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

main();
