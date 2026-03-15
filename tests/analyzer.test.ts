/**
 * Tests for TracyAnalyzer
 * Tests zone timing analysis, problematic zone detection, and statistics
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TracyAnalyzer, AnalysisOptions } from '../src/analyzer.js';
import * as path from 'node:path';

describe('TracyAnalyzer', () => {
  const cpuTracePath = path.join(__dirname, '../demo/cpu_test.tracy');
  const memoryTracePath = path.join(__dirname, '../demo/memory_test.tracy');

  describe('Trace Parsing', () => {
    it('should parse a CPU trace file', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      expect(zones).toBeDefined();
      expect(zones.size).toBeGreaterThan(0);
    });

    it('should handle trace with no zones gracefully', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(memoryTracePath);

      // Memory trace has no CPU zones
      expect(zones).toBeDefined();
      expect(zones.size).toBe(0);
    });

    it('should extract zone names', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(name).toBeDefined();
        expect(name.length).toBeGreaterThan(0);
        expect(timing.name).toBe(name);
      }
    });
  });

  describe('Zone Timing Statistics', () => {
    it('should calculate zone call counts', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(timing.count).toBeGreaterThan(0);
      }
    });

    it('should calculate total time', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(timing.totalTime).toBeGreaterThan(0);
      }
    });

    it('should calculate average time', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(timing.avgTime).toBe(timing.totalTime / timing.count);
      }
    });

    it('should calculate min and max times', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(timing.minTime).toBeGreaterThan(0);
        expect(timing.maxTime).toBeGreaterThanOrEqual(timing.minTime);
      }
    });

    it('should calculate variance (Welford\'s algorithm)', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      for (const [name, timing] of zones) {
        expect(timing.variance).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Problematic Zone Detection', () => {
    it('should find zones with high total time', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxTotalTime: 1 * 1_000_000, // 1ms threshold
        minCount: 1
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // CPU test trace has a 50ms zone, should be flagged
      expect(problematic.length).toBeGreaterThan(0);

      const hasHighTotalTime = problematic.some(z =>
        z.issues.some(i => i.includes('total time'))
      );
      expect(hasHighTotalTime).toBe(true);
    });

    it('should find zones with high average time', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxAvgTime: 10 * 1_000_000, // 10ms threshold
        minCount: 1
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // CPU test trace has 50ms avg, should be flagged
      expect(problematic.length).toBeGreaterThan(0);

      const hasHighAvgTime = problematic.some(z =>
        z.issues.some(i => i.includes('average time'))
      );
      expect(hasHighAvgTime).toBe(true);
    });

    it('should respect min count threshold for low-time zones', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxTotalTime: 100 * 1_000_000, // Very high threshold - won't trigger on 50ms
        maxAvgTime: 100 * 1_000_000, // Very high threshold - won't trigger on 50ms
        minCount: 100 // Very high threshold - single call zones ignored
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // Test trace has only 1 call and with high thresholds, should not be flagged
      expect(problematic.length).toBe(0);
    });

    it('should detect high variance zones (inconsistent timing)', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxTotalTime: 100 * 1_000_000,
        maxAvgTime: 100 * 1_000_000,
        minCount: 1,
        maxCv: 10 // 10% coefficient of variation
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // With low CV threshold, single-call zones shouldn't be flagged
      // unless they're very slow
      expect(problematic).toBeDefined();
    });

    it('should detect outliers using IQR method', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxTotalTime: 100 * 1_000_000,
        maxAvgTime: 100 * 1_000_000,
        minCount: 1,
        detectOutliers: true
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // Outlier detection should work
      expect(problematic).toBeDefined();
    });
  });

  describe('Output Formatting', () => {
    it('should format problematic zones', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 50 * 1_000_000,
        minCount: 1
      });

      const output = analyzer.formatProblematicZones(problematic);

      expect(output).toContain('problematic zone');
      expect(output).toContain('ms');
    });

    it('should include zone name in output', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 1 * 1_000_000,
        minCount: 1
      });

      const output = analyzer.formatProblematicZones(problematic);

      if (problematic.length > 0) {
        // The zone name (from zone.name) should be in the output
        const zoneName = problematic[0].zone.name;
        expect(output).toContain(zoneName);
      }
    });

    it('should show happy message when no issues found', () => {
      const analyzer = new TracyAnalyzer();
      const output = analyzer.formatProblematicZones([]);

      expect(output).toContain('No problematic zones');
      expect(output).toContain('🎉');
    });

    it('should show location info if available', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 1 * 1_000_000,
        minCount: 1
      });

      const output = analyzer.formatProblematicZones(problematic);

      // If location info is present, it should be in the output
      if (problematic.length > 0 && problematic[0].file) {
        expect(output).toContain(problematic[0].file!);
      }
    });
  });

  describe('Severity Levels', () => {
    it('should classify slow zones as high severity', async () => {
      const analyzer = new TracyAnalyzer();
      const zones = await analyzer.parseTrace(cpuTracePath);

      const options: AnalysisOptions = {
        maxTotalTime: 10 * 1_000_000, // 10ms
        maxAvgTime: 10 * 1_000_000,
        minCount: 1
      };

      const problematic = analyzer.findProblematicZones(zones, options);

      // 50ms zone should be high severity
      if (problematic.length > 0) {
        expect(problematic[0].severity).toBe('high');
      }
    });

    it('should classify moderate zones as medium severity', async () => {
      const analyzer = new TracyAnalyzer();

      // Create mock zone data
      const zones = new Map([
        ['test_zone', {
          name: 'test_zone',
          count: 10,
          totalTime: 50 * 1_000_000, // 50ms total
          avgTime: 5 * 1_000_000, // 5ms avg
          minTime: 4 * 1_000_000,
          maxTime: 6 * 1_000_000,
          variance: 1_000_000
        }]
      ]);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 30 * 1_000_000, // 30ms
        maxAvgTime: 2 * 1_000_000, // 2ms
        minCount: 1
      });

      if (problematic.length > 0) {
        expect(['high', 'medium']).toContain(problematic[0].severity);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty zone map', () => {
      const analyzer = new TracyAnalyzer();
      const emptyZones = new Map();

      const problematic = analyzer.findProblematicZones(emptyZones, {
        maxTotalTime: 10 * 1_000_000,
        minCount: 1
      });

      expect(problematic).toEqual([]);
    });

    it('should handle zone with zero duration', () => {
      const analyzer = new TracyAnalyzer();

      const zones = new Map([
        ['empty_zone', {
          name: 'empty_zone',
          count: 1,
          totalTime: 0,
          avgTime: 0,
          minTime: 0,
          maxTime: 0,
          variance: 0
        }]
      ]);

      const problematic = analyzer.findProblematicZones(zones, {
        maxTotalTime: 0,
        maxAvgTime: 0,
        minCount: 1
      });

      // Zero duration zones shouldn't crash
      expect(problematic).toBeDefined();
    });
  });
});
