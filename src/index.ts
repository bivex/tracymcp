#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { TracyReader, CompressionType } from "./reader.js";
import { TracyAnalyzer } from "./analyzer.js";
import { TracyMemoryParser } from "./memory.js";
import { TracyMessageParser } from "./messages.js";
import { TracyFrameParser } from "./frames.js";
import { TracyPlotParser } from "./plots.js";
import { TracyLockParser } from "./locks.js";
import { TracyGpuParser } from "./gpu.js";

const CSVEXPORT_BINARY = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "../../csvexport/build/tracy-csvexport"
);

// Real Tracy save files start with "tracy\0" after decompression.
// Synthetic event-stream traces (used by memory tools and tests) do not.
function isRealSaveFile(data: Buffer): boolean {
  return data.length >= 6 &&
    data[0] === 0x74 && data[1] === 0x72 && data[2] === 0x61 &&
    data[3] === 0x63 && data[4] === 0x79 && data[5] === 0x00;
}

const server = new Server(
  {
    name: "tracy",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_trace",
        description: "Read and analyze a Tracy .tracy trace file",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_zones",
        description: "List all profiling zones in a trace",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
            filter: {
              type: "string",
              description: "Optional filter pattern for zone names",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_zone_stats",
        description: "Get statistics for a specific zone",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
            zone: {
              type: "string",
              description: "Zone name to get stats for",
            },
          },
          required: ["path", "zone"],
        },
      },
      {
        name: "find_problematic_zones",
        description: "Find zones that need optimization based on real timing analysis from the trace",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
            max_total_time_ms: {
              type: "number",
              description: "Maximum total time threshold in milliseconds (default: 50)",
            },
            max_avg_time_ms: {
              type: "number",
              description: "Maximum average time threshold in milliseconds (default: 10)",
            },
            min_count: {
              type: "number",
              description: "Minimum call count to consider (default: 1)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_memory_stats",
        description: "Get memory statistics from a trace (allocations, frees, leaks)",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "find_memory_leaks",
        description: "Find memory leaks and issues in a trace",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the .tracy file",
            },
            max_leak_size_mb: {
              type: "number",
              description: "Maximum leak size to report in MB (default: 1)",
            },
            max_usage_mb: {
              type: "number",
              description: "Maximum current usage threshold in MB (default: 100)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_messages",
        description: "List TracyMessage/TracyMessageL log events from a trace with timestamps and severity",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the .tracy file" },
            filter: { type: "string", description: "Optional case-insensitive substring filter on message text" },
            severity: { type: "string", description: "Minimum severity to show: Trace|Debug|Info|Warning|Error|Fatal (default: Trace)" },
          },
          required: ["path"],
        },
      },
      {
        name: "get_frame_stats",
        description: "Get frame timing statistics from FrameMark events — FPS, frame time percentiles, dropped frames",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the .tracy file" },
          },
          required: ["path"],
        },
      },
      {
        name: "get_plot_stats",
        description: "Get statistics for TracyPlot custom metric streams",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the .tracy file" },
          },
          required: ["path"],
        },
      },
      {
        name: "find_lock_contention",
        description: "Find mutexes/locks with the most contention — total wait time, worst waits, contention count",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the .tracy file" },
            min_wait_ms: { type: "number", description: "Only show locks with total wait above this (default: 0.1)" },
          },
          required: ["path"],
        },
      },
      {
        name: "find_problematic_gpu_zones",
        description: "Find GPU zones that exceed timing thresholds",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to the .tracy file" },
            max_avg_time_ms: { type: "number", description: "Flag GPU zones averaging above this (default: 5)" },
            max_total_time_ms: { type: "number", description: "Flag GPU zones with total time above this (default: 50)" },
          },
          required: ["path"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error("No arguments provided");
  }

  switch (name) {
    case "read_trace": {
      const { path } = args as { path: string };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const reader = new TracyReader(path);
        const info = reader.getInfo();
        const data = await reader.readAllData();
        const basicInfo = reader.extractBasicInfo(data);
        reader.close();

        const compressionName = info.compressionType === CompressionType.Lz4 ? "LZ4" : "Zstd";
        const isSaveFile = isRealSaveFile(data);
        const fileType = isSaveFile
          ? "Tracy save file (use find_problematic_zones for analysis)"
          : "Synthetic event stream (supports memory tools)";

        return {
          content: [
            {
              type: "text",
              text: `Tracy Trace File Analysis
===========================
File: ${path}
Type: ${fileType}
Compression: ${compressionName}
Streams: ${info.streams}
File Size: ${info.fileSize} bytes (${(info.fileSize / 1024 / 1024).toFixed(2)} MB)
Decompressed Size: ${(data.length / 1024).toFixed(1)} KB

Note: Use find_problematic_zones for timing analysis or get_memory_stats for memory profiling.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading trace file: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "list_zones": {
      const { path, filter } = args as { path: string; filter?: string };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        // Detect file type to choose parsing strategy
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        let zoneNames: string[];

        if (isRealSaveFile(data)) {
          // Real Tracy save file — use csvexport for accurate zone names
          const result = spawnSync(CSVEXPORT_BINARY, [path], {
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
          });
          if (result.status !== 0 || !result.stdout) {
            throw new Error(`tracy-csvexport failed: ${result.stderr}`);
          }
          zoneNames = result.stdout.trim().split("\n").slice(1) // skip CSV header
            .map(line => {
              const parts = line.split(",");
              return parts.length >= 3 ? `${parts[0]}  (${parts[1]}:${parts[2]})` : parts[0];
            })
            .filter(n => !filter || n.toLowerCase().includes(filter.toLowerCase()));
        } else {
          // Synthetic event stream — heuristic string scan
          const r = new TracyReader(path);
          const zones = r.findPotentialZones(await r.readAllData(), filter);
          r.close();
          zoneNames = zones.map(z => z.name);
        }

        if (zoneNames.length === 0) {
          return {
            content: [{ type: "text", text: filter ? `No zones found matching: "${filter}"` : "No zones found in trace" }],
          };
        }

        const header = filter
          ? `Zones matching "${filter}" (${zoneNames.length} found):\n\n`
          : `All zones (${zoneNames.length} found):\n\n`;
        const list = zoneNames.slice(0, 100).map((n, i) => `${i + 1}. ${n}`).join("\n");
        const footer = zoneNames.length > 100 ? `\n...and ${zoneNames.length - 100} more` : "";

        return { content: [{ type: "text", text: header + list + footer }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing zones: ${error}` }],
          isError: true,
        };
      }
    }

    case "get_zone_stats": {
      const { path, zone } = args as { path: string; zone: string };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const analyzer = new TracyAnalyzer();
        const zones = await analyzer.parseTrace(path);

        const matches = Array.from(zones.values()).filter((z) => z.name === zone);

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: `Zone "${zone}" not found in trace.` }],
          };
        }

        const formatZone = (z: typeof matches[0], index?: number): string => {
          const cv = z.avgTime > 0
            ? (Math.sqrt(Math.abs(z.variance) / z.count) / z.avgTime) * 100
            : 0;
          const percentileLines = z.p50 !== undefined
            ? `P50: ${(z.p50 / 1_000_000).toFixed(3)} ms\nP90: ${(z.p90! / 1_000_000).toFixed(3)} ms\nP99: ${(z.p99! / 1_000_000).toFixed(3)} ms\n`
            : '';
          const header = matches.length > 1 && index !== undefined
            ? `[${index + 1}/${matches.length}] `
            : '';
          return `${header}Zone: ${z.name}
${z.thread ? `Thread: ${z.thread}` : ''}
${z.file ? `Location: ${z.file}:${z.line || '?'}` : ''}

Statistics
----------
Calls: ${z.count}
Total Time: ${(z.totalTime / 1_000_000).toFixed(3)} ms
Average Time: ${(z.avgTime / 1_000_000).toFixed(3)} ms
Min Time: ${(z.minTime / 1_000_000).toFixed(3)} ms
Max Time: ${(z.maxTime / 1_000_000).toFixed(3)} ms
Std Dev: ${(Math.sqrt(Math.abs(z.variance) / z.count) / 1_000_000).toFixed(3)} ms
Coefficient of Variation: ${cv.toFixed(1)}%
${percentileLines}`;
        };

        const text = matches.length === 1
          ? formatZone(matches[0])
          : `Found ${matches.length} zones named "${zone}" at different source locations:\n\n` +
            matches.map((z, i) => formatZone(z, i)).join("\n---\n\n");

        return { content: [{ type: "text", text }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error getting zone stats: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "find_problematic_zones": {
      const { path, max_total_time_ms, max_avg_time_ms, min_count } = args as {
        path: string;
        max_total_time_ms?: number;
        max_avg_time_ms?: number;
        min_count?: number;
      };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const analyzer = new TracyAnalyzer();
        const zones = await analyzer.parseTrace(path);

        const options = {
          maxTotalTime: max_total_time_ms ? max_total_time_ms * 1_000_000 : undefined,
          maxAvgTime: max_avg_time_ms ? max_avg_time_ms * 1_000_000 : undefined,
          minCount: min_count !== undefined ? min_count : 1,
        };

        const problematicZones = analyzer.findProblematicZones(zones, options);

        return {
          content: [
            {
              type: "text",
              text: analyzer.formatProblematicZones(problematicZones),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error analyzing trace: ${error}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "get_memory_stats": {
      const { path } = args as { path: string };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{
              type: "text",
              text: "Memory profiling requires a synthetic event-stream trace.\n\n" +
                "Real Tracy save files (.tracy from tracy-capture) store memory data in a binary format " +
                "that is not yet supported by this tool. Instrument your app with TRACY_ALLOC/TRACY_FREE " +
                "macros and record a trace specifically for memory analysis.",
            }],
          };
        }

        const memoryParser = new TracyMemoryParser();
        const stats = memoryParser.parseMemoryEvents(data);

        return {
          content: [{ type: "text", text: memoryParser.formatMemoryStats(stats) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error analyzing memory: ${error}` }],
          isError: true,
        };
      }
    }

    case "find_memory_leaks": {
      const { path, max_leak_size_mb, max_usage_mb } = args as {
        path: string;
        max_leak_size_mb?: number;
        max_usage_mb?: number;
      };

      if (!fs.existsSync(path)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: File not found: ${path}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{
              type: "text",
              text: "Memory leak detection requires a synthetic event-stream trace.\n\n" +
                "Real Tracy save files (.tracy from tracy-capture) store memory data in a binary format " +
                "that is not yet supported by this tool. Instrument your app with TRACY_ALLOC/TRACY_FREE " +
                "macros and record a trace specifically for memory analysis.",
            }],
          };
        }

        const memoryParser = new TracyMemoryParser();
        const stats = memoryParser.parseMemoryEvents(data);

        const issues = memoryParser.findMemoryIssues(stats, {
          maxLeakSize: max_leak_size_mb ? max_leak_size_mb * 1024 * 1024 : undefined,
          maxCurrentUsage: max_usage_mb ? max_usage_mb * 1024 * 1024 : undefined,
        });

        return {
          content: [{ type: "text", text: memoryParser.formatMemoryIssues(issues) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error analyzing memory leaks: ${error}` }],
          isError: true,
        };
      }
    }

    case "list_messages": {
      const { path, filter, severity } = args as { path: string; filter?: string; severity?: string };

      if (!fs.existsSync(path)) {
        return { content: [{ type: "text", text: `Error: File not found: ${path}` }], isError: true };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{ type: "text", text: "not supported for real Tracy save files — binary format not exposed by tracy-csvexport" }],
          };
        }

        const parser = new TracyMessageParser();
        const messages = parser.parse(data);
        return { content: [{ type: "text", text: parser.format(messages, filter, undefined, severity) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error parsing messages: ${error}` }], isError: true };
      }
    }

    case "get_frame_stats": {
      const { path } = args as { path: string };

      if (!fs.existsSync(path)) {
        return { content: [{ type: "text", text: `Error: File not found: ${path}` }], isError: true };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{ type: "text", text: "not supported for real Tracy save files — binary format not exposed by tracy-csvexport" }],
          };
        }

        const parser = new TracyFrameParser();
        const stats = parser.parse(data);
        return { content: [{ type: "text", text: parser.format(stats) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error parsing frame stats: ${error}` }], isError: true };
      }
    }

    case "get_plot_stats": {
      const { path } = args as { path: string };

      if (!fs.existsSync(path)) {
        return { content: [{ type: "text", text: `Error: File not found: ${path}` }], isError: true };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{ type: "text", text: "not supported for real Tracy save files — binary format not exposed by tracy-csvexport" }],
          };
        }

        const parser = new TracyPlotParser();
        const stats = parser.parse(data);
        return { content: [{ type: "text", text: parser.format(stats) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error parsing plot stats: ${error}` }], isError: true };
      }
    }

    case "find_lock_contention": {
      const { path, min_wait_ms } = args as { path: string; min_wait_ms?: number };

      if (!fs.existsSync(path)) {
        return { content: [{ type: "text", text: `Error: File not found: ${path}` }], isError: true };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{ type: "text", text: "not supported for real Tracy save files — binary format not exposed by tracy-csvexport" }],
          };
        }

        const parser = new TracyLockParser();
        const locks = parser.parse(data);
        return { content: [{ type: "text", text: parser.format(locks, min_wait_ms ?? 0.1) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error parsing lock contention: ${error}` }], isError: true };
      }
    }

    case "find_problematic_gpu_zones": {
      const { path, max_avg_time_ms, max_total_time_ms } = args as {
        path: string;
        max_avg_time_ms?: number;
        max_total_time_ms?: number;
      };

      if (!fs.existsSync(path)) {
        return { content: [{ type: "text", text: `Error: File not found: ${path}` }], isError: true };
      }

      try {
        const reader = new TracyReader(path);
        const data = await reader.readAllData();
        reader.close();

        if (isRealSaveFile(data)) {
          return {
            content: [{ type: "text", text: "not supported for real Tracy save files — binary format not exposed by tracy-csvexport" }],
          };
        }

        const parser = new TracyGpuParser();
        const zones = parser.parse(data);
        return { content: [{ type: "text", text: parser.format(zones, max_avg_time_ms ?? 5, max_total_time_ms ?? 50) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error parsing GPU zones: ${error}` }], isError: true };
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Tracy MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
