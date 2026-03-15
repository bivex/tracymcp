# Tracy MCP Server

Model Context Protocol server for [Tracy Profiler](https://github.com/wolfpld/tracy) `.tracy` trace files.

Lets Claude analyse real performance traces — find slow zones, memory leaks, and timing outliers.

## Requirements

- Node.js ≥ 18
- Tracy Profiler built from source (this repo)
- `tracy-capture` and `tracy-csvexport` binaries (see below)

## Build

```bash
# 1. Build tracy-csvexport (needed to parse real .tracy files)
cd /path/to/tracy/csvexport
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4

# 2. Build tracy-capture (needed to record traces)
cd /path/to/tracy/capture
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4

# 3. Install MCP server dependencies
cd /path/to/tracy/tracymcp
npm install
npm run build
```

## Recording a Trace

Instrument your app with Tracy (`TRACY_ENABLE`, `TracyCZoneN` / `ZoneScoped`), then capture:

```bash
# Start capture (waits for app to connect, saves on exit)
tracy-capture -o my_trace.tracy -f

# In another terminal — run your app
./my_app
```

The capture process exits automatically when the app disconnects and saves `my_trace.tracy`.

### Demo

```bash
cd tracymcp/demo
make            # Builds demo binary with Tracy zones
make run        # Run demo (must have tracy-capture running first)
```

## Configure Claude Code

Add to `~/.claude.json` (or project `.claude/settings.json`):

```json
{
  "mcpServers": {
    "tracy": {
      "command": "node",
      "args": ["/path/to/tracy/tracymcp/dist/index.js"]
    }
  }
}
```

Then restart Claude Code. The MCP tools appear automatically.

## Tools

### CPU Profiling

#### `find_problematic_zones`

Find zones that exceed timing thresholds. The main tool for performance work.

```
find_problematic_zones(
  path: "/path/to/trace.tracy",
  max_total_time_ms: 20,   // flag zones slower than 20ms total (default: 50)
  max_avg_time_ms: 5,      // flag zones slower than 5ms avg   (default: 10)
  min_count: 1             // ignore zones with fewer calls     (default: 1)
)
```

Output example:
```
Found 3 problematic zone(s):

🔴 #1: database_query (demo.c:86)
   Issues:
   • High total time: 66.28ms
   • High average time: 66.28ms
   Stats: 1 call, avg: 66.28ms, min: 66.28ms, max: 66.28ms, total: 66.28ms
   💡 Consider caching results or moving to background thread

🔴 #2: heavy_work (demo.c:12)
   ...
```

Severity is assigned automatically:
- 🔴 **high** — exceeds total time threshold
- 🟡 **medium** — exceeds average time or has P90 outliers
- 🟢 **low** — inconsistent timing (high CV)

#### `get_zone_stats`

Detailed statistics for a single zone by name.

```
get_zone_stats(
  path: "/path/to/trace.tracy",
  zone: "database_query"
)
```

Output includes min/max/avg/stddev and, for zones called many times, percentiles:
```
Zone: database_query
Location: demo.c:86

Statistics
----------
Calls: 1000
Total Time: 1234.567 ms
Average Time: 1.235 ms
Min Time: 0.812 ms
Max Time: 45.210 ms
Std Dev: 2.341 ms
Coefficient of Variation: 189.6%
P50: 0.934 ms
P90: 2.187 ms
P99: 18.432 ms
```

#### `list_zones`

List all zone names in a trace, with optional filter.

```
list_zones(path: "/path/to/trace.tracy", filter: "render")
```

#### `read_trace`

Basic file info: compression type, size, estimated event count.

```
read_trace(path: "/path/to/trace.tracy")
```

### Memory Profiling

#### `get_memory_stats`

Allocation summary for a trace.

```
get_memory_stats(path: "/path/to/trace.tracy")
```

```
Memory Statistics
==================
Total Allocated: 33.10 MB
Total Freed: 21.10 MB
Current Usage: 12.00 MB
Peak Usage: 32.00 MB
Allocations: 25
Frees: 23
Potential Leaks: 2
```

#### `find_memory_leaks`

Find allocations never freed and usage spikes.

```
find_memory_leaks(
  path: "/path/to/trace.tracy",
  max_leak_size_mb: 1,    // report leaks larger than 1MB (default: 1)
  max_usage_mb: 100       // flag if peak usage exceeds 100MB (default: 100)
)
```

## How It Works

`.tracy` files are the Tracy server's serialised state (not raw events). The MCP server:

1. Detects real Tracy save files by checking for the `"tracy\0"` magic after decompression
2. Delegates to `tracy-csvexport` which uses `TracyWorker` to fully parse the binary format
3. Runs both aggregated (`-` default) and per-call (`-u`) exports to compute percentiles
4. Synthetic test traces (raw event streams) are parsed by the built-in binary parser

```
.tracy file
    ├── is real save file? → tracy-csvexport → parse CSV → ZoneTiming map
    └── is synthetic?      → built-in binary parser      → ZoneTiming map
```

## Percentiles (P50/P90/P99)

For zones called more than once, the server computes percentiles from individual call data:

- **P50** — median call time
- **P90** — 90th percentile (most calls are faster than this)
- **P99** — 99th percentile (useful for finding tail latency)

A zone with low average but high P99 indicates rare but severe spikes — flagged as a medium-severity issue.

## Testing

```bash
npm test             # run all 67 tests
npm run test:watch   # watch mode
npm run test:coverage
```

Tests use synthetic `.tracy` files (raw event streams) so they don't depend on a built Tracy installation.

## TracyMemPro Instrumentation

For automatic `new`/`delete` tracking without modifying every callsite:

```cpp
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"

// All allocations are now tracked automatically
MyClass* obj = new MyClass();
delete obj;
```

See [`instrument/README.md`](instrument/README.md) for build instructions and full API.

## License

BSD-3-Clause
