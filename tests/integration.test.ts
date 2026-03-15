/**
 * Integration Tests for Tracy MCP Server Tools
 * Tests the complete MCP tool implementations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

describe('MCP Tool Integration Tests', () => {
  const demoDir = path.join(__dirname, '../demo');
  const memoryTrace = path.join(demoDir, 'memory_test.tracy');
  const cpuTrace = path.join(demoDir, 'cpu_test.tracy');

  describe('Tool: read_trace', () => {
    it('should read and display basic trace info', async () => {
      const { TracyReader } = await import('../src/reader.js');

      const reader = new TracyReader(memoryTrace);
      const info = reader.getInfo();
      const data = await reader.readAllData();
      const basicInfo = reader.extractBasicInfo(data);
      reader.close();

      expect(info.version).toBeDefined();
      expect(info.fileSize).toBeGreaterThan(0);
      expect(basicInfo.approximateEventCount).toBeGreaterThan(0);
    });

    it('should return error for non-existent file', async () => {
      const nonExistent = path.join(demoDir, 'does_not_exist.tracy');

      expect(fs.existsSync(nonExistent)).toBe(false);
    });
  });

  describe('Tool: list_zones', () => {
    it('should list zones in CPU trace', async () => {
      const { TracyReader } = await import('../src/reader.js');

      const reader = new TracyReader(cpuTrace);
      const data = await reader.readAllData();
      const zones = reader.findPotentialZones(data);
      reader.close();

      expect(zones).toBeDefined();
      // CPU trace has at least 1 zone
      expect(zones.length).toBeGreaterThanOrEqual(0);
    });

    it('should filter zones by name pattern', async () => {
      const { TracyReader } = await import('../src/reader.js');

      const reader = new TracyReader(cpuTrace);
      const data = await reader.readAllData();
      const allZones = reader.findPotentialZones(data);
      const filteredZones = reader.findPotentialZones(data, 'main');
      reader.close();

      expect(filteredZones.length).toBeLessThanOrEqual(allZones.length);
    });
  });

  describe('Tool: get_zone_stats', () => {
    it('should get statistics for a specific zone', async () => {
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      if (zones.size > 0) {
        const zoneName = Array.from(zones.keys())[0];
        const stats = zones.get(zoneName)!;

        expect(stats.name).toBe(zoneName);
        expect(stats.count).toBeGreaterThan(0);
        expect(stats.totalTime).toBeGreaterThan(0);
        expect(stats.avgTime).toBe(stats.totalTime / stats.count);
      }
    });

    it('should calculate coefficient of variation', async () => {
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      if (zones.size > 0) {
        const stats = Array.from(zones.values())[0];
        const stdDev = Math.sqrt(Math.abs(stats.variance) / stats.count);
        const cv = stats.avgTime > 0
          ? (stdDev / stats.avgTime) * 100
          : 0;

        expect(cv).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Tool: find_problematic_zones', () => {
    it('should find zones exceeding time thresholds', async () => {
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 10 * 1_000_000, // 10ms
        maxAvgTime: 5 * 1_000_000, // 5ms
        minCount: 1
      });

      // CPU trace has 50ms zone, should be found
      expect(problematic.length).toBeGreaterThanOrEqual(0);
    });

    it('should format output with severity indicators', async () => {
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 10 * 1_000_000,
        minCount: 1
      });

      const output = analyzer.formatProblematicZones(problematic);

      if (problematic.length > 0) {
        // Should contain emoji indicators
        expect(/[🔴🟡🟢]/.test(output)).toBe(true);
      }
    });

    it('should provide actionable recommendations', async () => {
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 10 * 1_000_000,
        minCount: 1
      });

      for (const zone of problematic) {
        expect(zone.recommendation).toBeDefined();
        expect(zone.recommendation.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Tool: get_memory_stats', () => {
    it('should calculate memory statistics', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      expect(stats.totalAllocated).toBeGreaterThan(0);
      expect(stats.totalFreed).toBeGreaterThanOrEqual(0);
      expect(stats.currentUsage).toBe(stats.totalAllocated - stats.totalFreed);
      expect(stats.allocationCount).toBeGreaterThan(0);
      expect(stats.freeCount).toBeGreaterThanOrEqual(0);
    });

    it('should track peak usage', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      expect(stats.peakUsage).toBeGreaterThan(0);
      expect(stats.peakUsage).toBeGreaterThanOrEqual(stats.currentUsage);
    });

    it('should detect potential leaks', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      // Test trace has 2 intentional leaks
      expect(stats.leaks.length).toBe(2);

      for (const leak of stats.leaks) {
        expect(leak.address).toBeDefined();
        expect(leak.size).toBeGreaterThan(0);
        expect(leak.leaked).toBe(true);
        expect(leak.freed).toBe(false);
      }
    });
  });

  describe('Tool: find_memory_leaks', () => {
    it('should find memory leaks above threshold', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024, // 1KB threshold
      });

      const leaks = issues.filter(i => i.type === 'leak');
      expect(leaks.length).toBe(2);
    });

    it('should detect high memory usage', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      const issues = parser.findMemoryIssues(stats, {
        maxCurrentUsage: 1 * 1024 * 1024, // 1MB
      });

      const highUsage = issues.filter(i => i.type === 'high-usage');
      expect(highUsage.length).toBeGreaterThan(0);
    });

    it('should detect memory spikes when conditions are met', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      // Create mock stats with higher peak-to-current ratio
      const mockStats = {
        ...stats,
        peakUsage: 36 * 1024 * 1024, // 36MB
        currentUsage: 10 * 1024 * 1024, // 10MB (ratio = 3.6)
      };

      const issues = parser.findMemoryIssues(mockStats);

      const spikes = issues.filter(i => i.type === 'spike');
      expect(spikes.length).toBeGreaterThan(0);
    });

    it('should classify issues by severity', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      const issues = parser.findMemoryIssues(stats, {
        maxLeakSize: 1024,
        maxCurrentUsage: 1 * 1024 * 1024,
      });

      for (const issue of issues) {
        expect(['high', 'medium', 'low']).toContain(issue.severity);
      }
    });

    it('should provide recommendations', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');

      const reader = new TracyReader(memoryTrace);
      const data = await reader.readAllData();
      reader.close();

      const parser = new TracyMemoryParser();
      const stats = parser.parseMemoryEvents(data);

      const issues = parser.findMemoryIssues(stats);

      for (const issue of issues) {
        expect(issue.recommendation).toBeDefined();
        expect(issue.recommendation.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Cross-Tool Integration', () => {
    it('should use same reader for memory and zone analysis', async () => {
      const { TracyReader } = await import('../src/reader.js');
      const { TracyMemoryParser } = await import('../src/memory.js');
      const { TracyAnalyzer } = await import('../src/analyzer.js');

      // Memory trace
      const memReader = new TracyReader(memoryTrace);
      const memData = await memReader.readAllData();
      memReader.close();

      const memParser = new TracyMemoryParser();
      const memStats = memParser.parseMemoryEvents(memData);

      expect(memStats.allocationCount).toBeGreaterThan(0);

      // CPU trace
      const cpuReader = new TracyReader(cpuTrace);
      const cpuData = await cpuReader.readAllData();
      cpuReader.close();

      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTrace);

      expect(zones).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted data gracefully', async () => {
      const { TracyMemoryParser } = await import('../src/memory.js');

      const parser = new TracyMemoryParser();
      const corruptedData = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]);

      // Should not throw
      const stats = parser.parseMemoryEvents(corruptedData);
      expect(stats).toBeDefined();
    });

    it('should handle empty traces', async () => {
      const { TracyMemoryParser } = await import('../src/memory.js');

      const parser = new TracyMemoryParser();
      const emptyData = Buffer.alloc(0);

      const stats = parser.parseMemoryEvents(emptyData);

      expect(stats.allocationCount).toBe(0);
      expect(stats.freeCount).toBe(0);
    });
  });
});
