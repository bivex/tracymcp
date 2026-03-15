/**
 * Tracy Zone Analyzer
 * Identifies problematic zones that need optimization
 */

import { TracyTraceParser, ZoneTiming } from './parser.js';

export interface ProblematicZone {
  zone: ZoneTiming;
  issues: string[];
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface AnalysisOptions {
  maxTotalTime?: number;     // zones above this (ns) are problematic
  maxAvgTime?: number;       // zones with avg above this are problematic
  maxVariance?: number;      // zones with inconsistent timing (legacy, same as maxCv)
  maxCv?: number;            // max coefficient of variation (%)
  minCount?: number;         // ignore zones called less than this
  detectOutliers?: boolean;  // enable IQR-based outlier detection
}

export class TracyAnalyzer {
  private parser: TracyTraceParser;

  constructor() {
    this.parser = new TracyTraceParser();
  }

  // Parse trace file and get zone timings
  async parseTrace(filePath: string): Promise<Map<string, ZoneTiming>> {
    return await this.parser.parseFile(filePath);
  }

  // Find zones that need optimization
  findProblematicZones(
    zones: Map<string, ZoneTiming>,
    options: AnalysisOptions = {}
  ): ProblematicZone[] {
    const problematic: ProblematicZone[] = [];
    const {
      maxTotalTime = 50_000_000,     // 50ms
      maxAvgTime = 10_000_000,        // 10ms
      maxVariance,
      maxCv,
      minCount = 10                   // ignore single calls
    } = options;
    const cvThreshold = (maxCv !== undefined ? maxCv / 100 : undefined) ?? (maxVariance ?? 0.5);

    for (const [name, zone] of zones) {
      const issues: string[] = [];
      let severity: 'high' | 'medium' | 'low' = 'low';

      // Check total time
      if (zone.totalTime > maxTotalTime) {
        issues.push(`High total time: ${(zone.totalTime / 1_000_000).toFixed(2)}ms`);
        severity = 'high';
      }

      // Check average time
      if (zone.avgTime > maxAvgTime) {
        issues.push(`High average time: ${(zone.avgTime / 1_000_000).toFixed(2)}ms`);
        if (severity === 'low') severity = 'medium';
      }

      // Check timing consistency (variance)
      const cv = zone.avgTime > 0 ? Math.sqrt(Math.abs(zone.variance) / zone.count) / zone.avgTime : 0;
      if (cv > cvThreshold && zone.count >= minCount) {
        issues.push(`Inconsistent timing (CV: ${(cv * 100).toFixed(1)}%)`);
        if (severity === 'low') severity = 'medium';
      }

      // Check for extreme outliers
      if (zone.maxTime > zone.avgTime * 10 && zone.count > 1) {
        issues.push(`Extreme outliers (max: ${(zone.maxTime / 1_000_000).toFixed(2)}ms, avg: ${(zone.avgTime / 1_000_000).toFixed(2)}ms)`);
        if (severity === 'low') severity = 'medium';
      }

      // Check P90 if per-call data is available
      if (zone.p90 !== undefined && zone.p90 > maxAvgTime * 2 && zone.count > 1) {
        issues.push(`High P90: ${(zone.p90 / 1_000_000).toFixed(2)}ms (P50: ${(zone.p50! / 1_000_000).toFixed(2)}ms, P99: ${(zone.p99! / 1_000_000).toFixed(2)}ms)`);
        if (severity === 'low') severity = 'medium';
      }

      // Check if zone is called enough to be relevant
      if (zone.count < minCount && zone.totalTime < maxTotalTime && issues.length < 2) {
        continue;
      }

      if (issues.length > 0) {
        problematic.push({
          zone,
          issues,
          severity,
          recommendation: this.generateRecommendation(zone, issues, severity)
        });
      }
    }

    // Sort by severity and total time
    return problematic.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return b.zone.totalTime - a.zone.totalTime;
    });
  }

  private generateRecommendation(zone: ZoneTiming, issues: string[], severity: string): string {
    const recommendations: string[] = [];

    if (zone.totalTime > 50_000_000) {
      recommendations.push('Consider caching results or moving to background thread');
    }

    if (zone.avgTime > 10_000_000) {
      recommendations.push('Optimize algorithm or reduce work per call');
    }

    if (issues.some(i => i.includes('Inconsistent'))) {
      recommendations.push('Investigate cause of timing variance (e.g., I/O, locks, conditional logic)');
    }

    if (issues.some(i => i.includes('outliers'))) {
      recommendations.push('Add instrumentation to identify slow code paths');
    }

    if (zone.count > 1000) {
      recommendations.push('Consider batching or reducing call frequency');
    }

    if (zone.function && zone.function.includes('alloc')) {
      recommendations.push('Consider memory pooling or reducing allocations');
    }

    return recommendations.length > 0
      ? recommendations.join('; ')
      : 'Profile with Tracy to identify specific bottlenecks';
  }

  // Format problematic zones for display
  formatProblematicZones(zones: ProblematicZone[]): string {
    if (zones.length === 0) {
      return 'No problematic zones found! 🎉\n\nAll zones are within acceptable performance thresholds.';
    }

    let output = `Found ${zones.length} problematic zone(s) that may need optimization:\n\n`;

    for (let i = 0; i < zones.length; i++) {
      const pz = zones[i];
      const icon = pz.severity === 'high' ? '🔴' : pz.severity === 'medium' ? '🟡' : '🟢';

      const threadSuffix = pz.zone.thread ? `  [${pz.zone.thread}]` : '';
      output += `${icon} #${i + 1}: ${pz.zone.name}${threadSuffix}\n`;

      if (pz.zone.function) {
        output += `   Function: ${pz.zone.function}`;
        if (pz.zone.file) {
          output += `\n   Location: ${pz.zone.file}:${pz.zone.line || '?'}`;
        }
        output += '\n';
      }

      output += `   Issues:\n`;
      for (const issue of pz.issues) {
        output += `   • ${issue}\n`;
      }

      output += `   Stats: ${pz.zone.count} call${pz.zone.count > 1 ? 's' : ''}, ` +
        `avg: ${(pz.zone.avgTime / 1_000_000).toFixed(2)}ms, ` +
        `min: ${(pz.zone.minTime / 1_000_000).toFixed(2)}ms, ` +
        `max: ${(pz.zone.maxTime / 1_000_000).toFixed(2)}ms, ` +
        `total: ${(pz.zone.totalTime / 1_000_000).toFixed(2)}ms\n`;

      output += `   💡 ${pz.recommendation}\n\n`;
    }

    return output;
  }
}
