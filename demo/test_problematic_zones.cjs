#!/usr/bin/env node
/**
 * Test the find_problematic_zones tool
 */

const { TracyAnalyzer } = require('../dist/analyzer.js');

async function main() {
  console.log('Testing Tracy Analyzer - Find Problematic Zones\n');

  const analyzer = new TracyAnalyzer();

  // Create mock timings
  const zones = analyzer.analyzeTrace(Buffer.alloc(1));
  console.log(`Analyzed ${zones.size} zones\n`);

  // Find problematic zones with default options
  const problematic = analyzer.findProblematicZones(zones);
  console.log('=== Default Options ===');
  console.log(analyzer.formatProblematicZones(problematic));

  console.log('\n=== Strict Options (5ms max avg) ===');
  const strictOptions = {
    maxTotalTime: 30_000_000,  // 30ms
    maxAvgTime: 5_000_000,     // 5ms
    minCount: 1
  };
  const strictProblematic = analyzer.findProblematicZones(zones, strictOptions);
  console.log(analyzer.formatProblematicZones(strictProblematic));

  console.log('\n=== Permissive Options (100ms max total) ===');
  const permissiveOptions = {
    maxTotalTime: 100_000_000,  // 100ms
    maxAvgTime: 50_000_000,     // 50ms
    minCount: 5
  };
  const permissiveProblematic = analyzer.findProblematicZones(zones, permissiveOptions);
  console.log(analyzer.formatProblematicZones(permissiveProblematic));
}

main().catch(console.error);
