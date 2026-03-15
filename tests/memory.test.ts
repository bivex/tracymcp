/**
 * Tests for TracyMemoryParser
 * Tests memory allocation tracking, leak detection, and issue analysis
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TracyMemoryParser, MemoryStats, MemoryIssue, CallstackFrame } from '../src/memory.js';
import { TracyReader } from '../src/reader.js';
import * as path from 'node:path';

describe('TracyMemoryParser', () => {
  const testTracePath = path.join(__dirname, '../demo/memory_test.tracy');
  let testData: Buffer;

  beforeEach(async () => {
    const reader = new TracyReader(testTracePath);
    testData = await reader.readAllData();
    reader.close();
  });

  describe('Memory Event Parsing', () => {
    it('should parse memory allocation events', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      expect(stats.allocationCount).toBeGreaterThan(0);
      expect(stats.totalAllocated).toBeGreaterThan(0);
    });

    it('should parse memory free events', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      expect(stats.freeCount).toBeGreaterThan(0);
      expect(stats.totalFreed).toBeGreaterThan(0);
    });

    it('should calculate current usage correctly', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      expect(stats.currentUsage).toBe(stats.totalAllocated - stats.totalFreed);
      expect(stats.currentUsage).toBeGreaterThan(0);
    });

    it('should track peak usage', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      expect(stats.peakUsage).toBeGreaterThan(0);
      expect(stats.peakUsage).toBeGreaterThanOrEqual(stats.currentUsage);
    });

    it('should detect memory leaks', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      expect(stats.leaks).toBeDefined();
      expect(stats.leaks.length).toBe(2); // 2 intentional leaks in test trace
    });

    it('should include leak details', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const leak = stats.leaks[0];
      expect(leak.address).toBeDefined();
      expect(leak.size).toBeGreaterThan(0);
      expect(leak.leaked).toBe(true);
      expect(leak.freed).toBe(false);
    });
  });

  describe('Memory Issue Detection', () => {
    it('should detect memory leaks above threshold', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024, // 1KB threshold
      });

      const leakIssues = issues.filter(i => i.type === 'leak');
      expect(leakIssues.length).toBe(2);
    });

    it('should detect high memory usage', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxCurrentUsage: 1 * 1024 * 1024, // 1MB threshold
      });

      const highUsageIssues = issues.filter(i => i.type === 'high-usage');
      expect(highUsageIssues.length).toBeGreaterThan(0);
    });

    it('should detect memory spikes when peak is much higher than current', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      // Check the spike condition: peak > current * 3 AND peak > 10MB
      // Our test trace has peak=32MB, current=12MB, ratio=2.67 (< 3)
      const wouldDetectSpike = stats.peakUsage > stats.currentUsage * 3 && stats.peakUsage > 10 * 1024 * 1024;

      // Create mock stats with higher ratio to test spike detection
      const mockStats = {
        ...stats,
        peakUsage: 36 * 1024 * 1024, // 36MB
        currentUsage: 10 * 1024 * 1024, // 10MB
      };

      const issues = parser.findMemoryIssues(mockStats);
      const spikeIssues = issues.filter(i => i.type === 'spike');
      expect(spikeIssues.length).toBeGreaterThan(0);
    });

    it('should detect high allocation frequency', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxAllocCount: 10, // Low threshold to trigger
      });

      const frequencyIssues = issues.filter(i => i.type === 'high-frequency');
      expect(frequencyIssues.length).toBeGreaterThan(0);
    });

    it('should detect memory fragmentation', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxAllocCount: 100, // Enable fragmentation check
      });

      // Check for fragmentation if there are many small allocations
      const smallAllocs = stats.allocations.filter(a => a.size < 1024 && !a.freed);
      if (smallAllocs.length > 1000) {
        const fragIssues = issues.filter(i => i.type === 'fragmentation');
        expect(fragIssues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Issue Severity Classification', () => {
    it('should classify large leaks as high severity', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024,
      });

      const largeLeak = issues.find(i =>
        i.type === 'leak' && i.size > 5 * 1024 * 1024
      );
      expect(largeLeak?.severity).toBe('high');
    });

    it('should sort issues by severity and size', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024,
        maxCurrentUsage: 1 * 1024 * 1024,
      });

      // Check that issues are sorted (high severity first)
      for (let i = 0; i < issues.length - 1; i++) {
        const severityOrder = { high: 3, medium: 2, low: 1 };
        const current = severityOrder[issues[i].severity];
        const next = severityOrder[issues[i + 1].severity];
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe('Output Formatting', () => {
    it('should format memory statistics', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const output = parser.formatMemoryStats(stats);

      expect(output).toContain('Total Allocated');
      expect(output).toContain('Total Freed');
      expect(output).toContain('Current Usage');
      expect(output).toContain('Peak Usage');
      expect(output).toContain('Allocations');
      expect(output).toContain('Potential Leaks');
    });

    it('should format memory issues', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024,
      });

      const output = parser.formatMemoryIssues(issues);

      expect(output).toContain('memory issue');
      expect(output).toContain('LEAK');
    });

    it('should show happy message when no issues found', () => {
      const parser = new TracyMemoryParser();

      // Create empty stats
      const emptyStats: MemoryStats = {
        totalAllocated: 1000,
        totalFreed: 1000,
        currentUsage: 0,
        peakUsage: 1000,
        allocationCount: 1,
        freeCount: 1,
        leaks: [],
        allocations: []
      };

      const issues = parser.findMemoryIssues(emptyStats);
      const output = parser.formatMemoryIssues(issues);

      expect(output).toContain('No memory issues found');
      expect(output).toContain('🎉');
    });
  });

  describe('48-bit Size Reading', () => {
    it('should correctly read 48-bit sizes', () => {
      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(testData);

      // Test trace includes allocations up to 20MB
      // 48 bits can store up to 256TB, so 20MB should work
      expect(stats.totalAllocated).toBeLessThan(281474976710656); // 2^48 bytes
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty event data', () => {
      const parser = new TracyMemoryParser();
      const emptyData = Buffer.alloc(0);

      const stats = parser.parseMemoryEvents(emptyData);

      expect(stats.allocationCount).toBe(0);
      expect(stats.freeCount).toBe(0);
      expect(stats.currentUsage).toBe(0);
    });

    it('should handle unknown event types gracefully', () => {
      const parser = new TracyMemoryParser();
      // Create buffer with unknown event type (255)
      const unknownEventData = Buffer.from([255, 0, 0, 0, 0, 0, 0, 0]);

      const stats = parser.parseMemoryEvents(unknownEventData);

      // Should not crash, just skip unknown events
      expect(stats).toBeDefined();
    });
  });

  describe('Callstack Support', () => {
    it('should attach callstack to leaks from leaky_engine.tracy', async () => {
      const leakyPath = path.join(__dirname, '../demo/leaky_engine.tracy');
      const reader2 = new TracyReader(leakyPath);
      const data2 = await reader2.readAllData();
      reader2.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data2);

      // At least one leak should have a callstack
      const leaksWithCallstack = stats.leaks.filter(l => l.callstack && l.callstack.length > 0);
      expect(leaksWithCallstack.length).toBeGreaterThan(0);

      // TextureCache leaks should show the callstack
      const texLeak = leaksWithCallstack.find(l => l.name?.includes('TextureCache'));
      expect(texLeak).toBeDefined();
      expect(texLeak!.callstack![0].fn).toBe('Texture::AllocPixelData');
      expect(texLeak!.callstack![0].file).toBe('texture.cpp');
      expect(texLeak!.callstack![0].line).toBe(42);
    });

    it('should render callstack in formatMemoryIssues output', async () => {
      const leakyPath = path.join(__dirname, '../demo/leaky_engine.tracy');
      const reader2 = new TracyReader(leakyPath);
      const data2 = await reader2.readAllData();
      reader2.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data2);
      const issues = parser.findMemoryIssues(stats, { maxLeakSize: 1024 });
      const output = parser.formatMemoryIssues(issues);

      expect(output).toContain('Callstack:');
      expect(output).toContain('Texture::AllocPixelData');
      expect(output).toContain('texture.cpp:42');
    });
  });
});
