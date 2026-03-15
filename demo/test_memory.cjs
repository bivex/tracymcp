#!/usr/bin/env node
/**
 * Test memory profiling features
 */

const { TracyMemoryParser } = require('../dist/memory.js');

async function main() {
  console.log('Testing Tracy Memory Profiler\n');

  const parser = new TracyMemoryParser();

  // Get memory stats
  console.log('=== Memory Statistics ===');
  const stats = parser.parseMemoryEvents(Buffer.alloc(1));
  console.log(parser.formatMemoryStats(stats));

  console.log('\n=== Memory Issues (Default) ===');
  const issues = parser.findMemoryIssues(stats);
  console.log(parser.formatMemoryIssues(issues));

  console.log('\n=== Memory Issues (Strict: 1MB max leak) ===');
  const strictIssues = parser.findMemoryIssues(stats, {
    maxLeakSize: 1 * 1024 * 1024,
    maxCurrentUsage: 20 * 1024 * 1024
  });
  console.log(parser.formatMemoryIssues(strictIssues));

  console.log('\n=== Memory Issues (Permissive: 50MB max usage) ===');
  const permissiveIssues = parser.findMemoryIssues(stats, {
    maxLeakSize: 20 * 1024 * 1024,
    maxCurrentUsage: 50 * 1024 * 1024
  });
  console.log(parser.formatMemoryIssues(permissiveIssues));
}

main();
