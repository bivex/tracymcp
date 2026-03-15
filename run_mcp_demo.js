/**
 * TracyMemPro MCP Demo
 * Demonstrates the full workflow: app with TracyMemPro → Tracy capture → MCP analysis
 */

import { TracyReader } from './dist/reader.js';
import { TracyMemoryParser } from './dist/memory.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function demo() {
  console.log('========================================');
  console.log('TracyMemPro MCP Demo');
  console.log('========================================\n');

  console.log('Workflow: app with TracyMemPro → Tracy capture → MCP analysis\n');

  const tracePath = join(__dirname, 'demo', 'memory_test.tracy');
  const reader = new TracyReader(tracePath);
  const data = await reader.readAllData();
  reader.close();

  const parser = new TracyMemoryParser();
  const stats = parser.parseMemoryEvents(data);

  console.log('📊 Memory Statistics:');
  console.log('-------------------');
  console.log('  Allocations: ' + stats.allocationCount);
  console.log('  Frees: ' + stats.freeCount);
  console.log('  Total allocated: ' + (stats.totalAllocated / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  Current usage: ' + (stats.currentUsage / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  Peak usage: ' + (stats.peakUsage / 1024 / 1024).toFixed(2) + ' MB');
  console.log('  Leaks found: ' + stats.leaks.length);

  console.log('\n🔍 Memory Issues:');
  const issues = parser.findMemoryIssues(stats, {
    maxLeakSize: 1024,
    maxCurrentUsage: 50 * 1024 * 1024,
  });

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
    console.log('  ' + icon + ' ' + issue.type.toUpperCase() + ': ' + (issue.size / 1024).toFixed(1) + 'KB' +
                   (issue.address !== 0n ? ' @ 0x' + issue.address.toString(16) : ''));
  }

  console.log('\n💡 Recommendations:');
  for (const issue of issues) {
    if (issue.recommendation) {
      console.log('  • ' + issue.recommendation);
    }
  }

  console.log('\n========================================');
  console.log('✓ TracyMemPro workflow verified!');
  console.log('========================================');
  console.log('\nNote: To use with your application:');
  console.log('1. Add TracyMemPro.hpp to your code');
  console.log('2. Run with Tracy Profiler connected');
  console.log('3. Save trace as .tracy file');
  console.log('4. Analyze with MCP tools');
}

demo().catch(console.error);
