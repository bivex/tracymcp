#!/usr/bin/env node
/**
 * Verify statistical calculations
 */

// Test Welford's algorithm for online variance calculation
function welfordTest() {
  const values = [10, 12, 9, 11, 10.5]; // ms

  let n = 0;
  let mean = 0;
  let M2 = 0; // accumulated variance

  for (const x of values) {
    n++;
    const delta = x - mean;
    mean += delta / n;
    const delta2 = x - mean;
    M2 += delta * delta2;

    console.log(`n=${n}, x=${x}, mean=${mean.toFixed(4)}, delta=${delta.toFixed(4)}, delta2=${delta2.toFixed(4)}, M2=${M2.toFixed(4)}`);
  }

  const variance = M2 / n;
  const stdDev = Math.sqrt(variance);
  const cv = (stdDev / mean) * 100;

  console.log('\nResults:');
  console.log(`Count: ${n}`);
  console.log(`Mean: ${mean.toFixed(4)} ms`);
  console.log(`Variance (M2/n): ${variance.toFixed(4)}`);
  console.log(`Std Dev: ${stdDev.toFixed(4)} ms`);
  console.log(`CV: ${cv.toFixed(2)}%`);

  // Verify with calc
  console.log('\nManual verification:');
  const sum = values.reduce((a, b) => a + b, 0);
  const manualMean = sum / values.length;
  console.log(`Manual mean: ${manualMean.toFixed(4)} ms`);

  const sqDiff = values.map(x => Math.pow(x - manualMean, 2));
  const manualVariance = sqDiff.reduce((a, b) => a + b, 0) / values.length;
  console.log(`Manual variance: ${manualVariance.toFixed(4)}`);
  console.log(`Manual std dev: ${Math.sqrt(manualVariance).toFixed(4)} ms`);
}

// Test our parser's calculation
function testParserCalculation() {
  console.log('\n\n=== Testing Parser Calculation ===');

  // Simulate what the parser does
  const timings = [10, 12, 9, 11, 10.5]; // in ms
  const nsTimings = timings.map(t => t * 1_000_000); // convert to ns

  let count = 0;
  let totalTime = 0;
  let minTime = nsTimings[0];
  let maxTime = nsTimings[0];
  let avgTime = 0;
  let variance = 0;

  for (const duration of nsTimings) {
    count++;
    totalTime += duration;

    if (duration < minTime) minTime = duration;
    if (duration > maxTime) maxTime = duration;

    // Welford's method (from parser line 336-339)
    const delta = duration - avgTime;
    avgTime += delta / count;
    const delta2 = duration - avgTime;
    variance += delta * delta2;

    console.log(`Sample ${count}: ${duration} ns (${(duration/1_000_000).toFixed(2)} ms)`);
    console.log(`  avg: ${(avgTime/1_000_000).toFixed(4)} ms, variance: ${variance}`);
  }

  const stdDev = Math.sqrt(Math.abs(variance) / count);
  const cv = avgTime > 0 ? (stdDev / avgTime) * 100 : 0;

  console.log('\nFinal Results:');
  console.log(`Count: ${count}`);
  console.log(`Total: ${(totalTime/1_000_000).toFixed(2)} ms`);
  console.log(`Min: ${(minTime/1_000_000).toFixed(2)} ms`);
  console.log(`Max: ${(maxTime/1_000_000).toFixed(2)} ms`);
  console.log(`Avg: ${(avgTime/1_000_000).toFixed(4)} ms`);
  console.log(`Variance (M2): ${variance}`);
  console.log(`Std Dev: ${(stdDev/1_000_000).toFixed(4)} ms`);
  console.log(`CV: ${cv.toFixed(2)}%`);
}

// Test nanosecond conversion
function testNsToMs() {
  console.log('\n\n=== Testing ns to ms conversion ===');

  const ns = 50_000_000; // 50ms
  const ms = ns / 1_000_000;
  console.log(`${ns} ns = ${ms} ms`);

  // Test edge cases
  const testCases = [
    { ns: 1, expected: '0.000001 ms' },
    { ns: 1000, expected: '0.001 ms' },
    { ns: 1_000_000, expected: '1 ms' },
    { ns: 16_666_667, expected: '16.667 ms' },
    { ns: 100_000_000, expected: '100 ms' },
  ];

  for (const { ns, expected } of testCases) {
    const ms = ns / 1_000_000;
    console.log(`${ns} ns = ${ms} ms (expected: ${expected})`);
  }
}

welfordTest();
testParserCalculation();
testNsToMs();
