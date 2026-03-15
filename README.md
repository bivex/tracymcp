# Tracy MCP Server

Model Context Protocol server for [Tracy Profiler](https://github.com/wolfpld/tracy) `.tracy` trace files.
Lets Claude read real performance traces and help you find and fix problems.

## Setup

### 1. Build dependencies

```bash
# tracy-csvexport — needed to parse real .tracy save files
cd /path/to/tracy/csvexport
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)

# tracy-capture — needed to record traces from running apps
cd /path/to/tracy/capture
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j$(nproc)
```

### 2. Install and build the MCP server

```bash
cd /path/to/tracy/tracymcp
npm install
npm run build
```

### 3. Register with Claude Code

Add to `~/.claude.json` (global) or `.claude/settings.json` (project):

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

Restart Claude Code. The tools are available immediately.

---

## Recording a Trace

Instrument your app with Tracy macros, then capture while it runs:

```bash
# Terminal 1 — start capture (waits for app, saves on disconnect)
tracy-capture -o my_trace.tracy -f

# Terminal 2 — run your app
./my_app
```

When your app exits, `my_trace.tracy` is saved automatically. Pass that path to any tool below.

### Quick demo

```bash
cd tracymcp/demo
make          # build demo C program
make run      # run it (requires tracy-capture running in another terminal)
```

---

## Debugging with Claude

The intended workflow is: record a trace, hand the path to Claude, describe the symptom.
Claude picks the right tool(s), interprets the numbers, and tells you what to fix.

### "My app is slow — what's taking the most time?"

```
find_problematic_zones(path="/traces/my_trace.tracy")
```

You get a ranked list of slow zones with severity, timings, and a suggested fix.
Thread names are shown when available:

```
Found 3 problematic zone(s):

🔴 #1: database_query  [main thread]
   Location: main.cpp:86
   Issues:
   • High total time: 66.28 ms
   • High average time: 66.28 ms
   Stats: 1 call, avg: 66.28ms, min: 66.28ms, max: 66.28ms, total: 66.28ms
   💡 Consider caching results or moving to background thread

🟡 #2: render  [render thread]
   Location: renderer.cpp:210
   Issues:
   • High P90: 12.40ms (P50: 1.54ms, P99: 18.35ms)
   Stats: 847 calls, avg: 2.10ms, min: 0.81ms, max: 18.35ms, total: 1779.37ms
   💡 Investigate occasional spikes — may be GC or lock contention

🟢 #3: physics_update  [worker]
   Location: physics.cpp:44
   Issues:
   • Inconsistent timing (CV: 94.0%)
   Stats: 847 calls, avg: 1.20ms, min: 0.10ms, max: 9.70ms, total: 1016.40ms
   💡 Check for variable-sized work batches or lock contention
```

Tighten the thresholds if your app has a strict frame budget:

```
find_problematic_zones(
  path="/traces/my_trace.tracy",
  max_total_time_ms=16,    # flag anything over 16 ms total
  max_avg_time_ms=2        # flag anything averaging over 2 ms
)
```

---

### "I need full stats for one specific function"

```
get_zone_stats(path="/traces/my_trace.tracy", zone="render")
```

```
Zone: render
Thread: render thread
Location: renderer.cpp:210

Statistics
----------
Calls: 847
Total Time: 1779.370 ms
Average Time: 2.101 ms
Min Time: 0.812 ms
Max Time: 18.347 ms
Std Dev: 1.834 ms
Coefficient of Variation: 87.3%
P50: 1.540 ms
P90: 4.210 ms
P99: 12.860 ms
```

A high P99 with a low average means rare but severe spikes — worth investigating separately.
If the same zone name appears at multiple source locations (e.g. `render` defined in five files),
all of them are shown with their `[1/5]` prefix.

---

### "What zones exist in this trace?"

```
list_zones(path="/traces/my_trace.tracy")
list_zones(path="/traces/my_trace.tracy", filter="render")  # narrow down
```

Use this to explore unfamiliar traces or find the exact name to pass to `get_zone_stats`.

---

### "I suspect a memory leak — where is it?"

```
get_memory_stats(path="/traces/my_trace.tracy")
```

```
Memory Statistics
==================
Total Allocated: 180.99 MB
Total Freed: 151.59 MB
Current Usage: 29.40 MB
Peak Usage: 93.40 MB
Allocations: 624
Frees: 261
Potential Leaks: 363
```

If `Current Usage` is much higher than expected, or `Potential Leaks` is nonzero, dig in:

```
find_memory_leaks(path="/traces/my_trace.tracy")
```

```
Found 5 memory issue(s):

🔴 #1: LEAK
   Memory leak: 16384.0 KB at 0x10003000 (TextureCache/terrain_normal.dds)
   💡 Ensure proper deallocation or use smart pointers/RAII

🔴 #2: LEAK
   Memory leak: 4096.0 KB at 0x10002000 (TextureCache/terrain_diffuse.dds)
   💡 Ensure proper deallocation or use smart pointers/RAII

🟡 #3: SPIKE
   Memory spike: peak was 93.4 MB, now 29.4 MB
   💡 Investigate temporary allocations — consider reusing memory or object pooling
```

By default only leaks > 1 MB are shown. Lower the threshold to catch smaller ones:

```
find_memory_leaks(
  path="/traces/my_trace.tracy",
  max_leak_size_mb=0.064    # show everything above 64 KB
)
```

---

### "What did my app log during the trace?"

```
list_messages(path="/traces/my_trace.tracy")
list_messages(path="/traces/my_trace.tracy", severity="Warning")
list_messages(path="/traces/my_trace.tracy", filter="timeout")
```

```
5 message(s):

[   0.000ms] ℹ️  INFO     Engine initialised
[  16.000ms] ℹ️  INFO     Frame 1 complete
[  32.500ms] ⚠️  WARNING  Frame took 50ms — over budget
[  82.000ms] ❌ ERROR    Shader compile failed: syntax error at line 42
[  82.100ms] ℹ️  INFO     Fallback shader loaded
```

Useful for correlating log events with timing spikes from `find_problematic_zones`.

---

### "Is my frame rate stable?"

```
get_frame_stats(path="/traces/my_trace.tracy")
```

```
Frame Stats
===========

[Game Frame] 3 frames
  Avg FPS:      41.7
  Avg frame:    24.0 ms
  P50:          16.0 ms
  P99:          50.0 ms
  Min:          16.0 ms
  Max:          50.0 ms
  Dropped (>16.7ms): 1 / 3 (33.3%)
```

`Dropped` counts frames that exceeded 60 Hz budget. A high P99 with a low average points to
occasional hitches rather than a sustained throughput problem.

---

### "What are my custom metrics doing?"

```
get_plot_stats(path="/traces/my_trace.tracy")
```

```
Plot Stats
==========

FPS
  Min:      41.7
  Max:     120.0
  Avg:      85.3
  Last:     60.0
  Duration: 1000.0 ms
```

Use `TracyPlot("FPS", fps)` in your app to push any numeric metric into the trace.
Good candidates: draw calls, entity count, cache hit rate, queue depth.

---

### "Where are threads blocking on locks?"

```
find_lock_contention(path="/traces/my_trace.tracy")
find_lock_contention(path="/traces/my_trace.tracy", min_wait_ms=5)
```

```
Lock Contention Report
======================

RenderMutex (lock 0x1001)
  Total wait:   7.0 ms
  Max single wait: 7.0 ms
  Contention count: 1
  💡 Consider lock-free data structures or finer-grained locking
```

High `contention count` with low `max single wait` suggests frequent but short blocking —
a candidate for a reader-writer lock or lock-free queue.
High `max single wait` with low count means rare but severe stalls — look for long critical sections.

---

### "Is the GPU keeping up?"

```
find_problematic_gpu_zones(path="/traces/my_trace.tracy")
find_problematic_gpu_zones(path="/traces/my_trace.tracy", max_avg_time_ms=2, max_total_time_ms=16)
```

```
Problematic GPU Zones
=====================

🔴 DrawScene  (context 0)
   Total: 8.0 ms, Avg: 8.0 ms, Calls: 1
   💡 Optimize shaders or reduce draw call count
```

GPU zones are recorded with `TracyGpuZone` / `TracyGpuZoneC`. They show actual GPU time,
not CPU submission time.

---

### Typical full debugging session

```
# 1. Orient — what kind of file is this?
read_trace(path="/traces/my_trace.tracy")

# 2. Explore — what zones are instrumented?
list_zones(path="/traces/my_trace.tracy")

# 3. Find CPU hot spots (with thread names)
find_problematic_zones(path="/traces/my_trace.tracy", max_total_time_ms=10)

# 4. Drill into the worst offender
get_zone_stats(path="/traces/my_trace.tracy", zone="database_query")

# 5. Check frame pacing
get_frame_stats(path="/traces/my_trace.tracy")

# 6. Check GPU
find_problematic_gpu_zones(path="/traces/my_trace.tracy")

# 7. Find lock bottlenecks
find_lock_contention(path="/traces/my_trace.tracy")

# 8. Check memory
get_memory_stats(path="/traces/my_trace.tracy")
find_memory_leaks(path="/traces/my_trace.tracy", max_leak_size_mb=0.1)

# 9. Read log messages around the spike
list_messages(path="/traces/my_trace.tracy", severity="Warning")
```

---

## Automatic new/delete Tracking

To track every allocation without touching every callsite, use `TracyMemPro.hpp`:

```cpp
// At the top of one .cpp file (e.g. main.cpp)
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"

// Nothing else to change — all new/delete are now reported to Tracy
MyClass* obj = new MyClass();   // tracked
delete obj;                     // tracked
```

The allocations show up in `find_memory_leaks` with their source name attached.
See [`instrument/README.md`](instrument/README.md) for the full API, custom allocator hooks,
and build instructions.

---

## How It Works

`.tracy` save files contain Tracy's serialised worker state, not raw events.
The server handles two formats transparently:

```
.tracy file
  ├── magic == "tracy\0" after decompress?
  │     YES → delegate to tracy-csvexport → parse CSV → zone timings
  └──   NO  → built-in binary parser (synthetic / test traces)
```

For real save files the server runs `tracy-csvexport` twice:
- default mode → aggregated stats (total, avg, min, max, stddev)
- `-u` mode → one row per call → used to compute P50/P90/P99

The following tools require the synthetic event-stream format (not real `.tracy` save files)
because `tracy-csvexport` does not expose this data:
- `get_memory_stats`, `find_memory_leaks`
- `list_messages`, `get_frame_stats`, `get_plot_stats`
- `find_lock_contention`, `find_problematic_gpu_zones`

For these tools on a real app, instrument and capture a dedicated trace using the event types
described in `instrument/` — or file an issue if you need csvexport support added upstream.

---

## Reference

### `find_problematic_zones`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `max_total_time_ms` | number | 50 | Flag zones with total time above this |
| `max_avg_time_ms` | number | 10 | Flag zones with average time above this |
| `min_count` | number | 1 | Ignore zones called fewer times than this |

Severity levels:
- 🔴 **high** — total time exceeds threshold
- 🟡 **medium** — average time exceeds threshold, or P90 >> average
- 🟢 **low** — high coefficient of variation (inconsistent timing)

Thread names are shown in brackets when present in the trace.

### `get_zone_stats`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `zone` | string | required | Zone name (exact match) |

Returns all zones with that name, including thread name and source location.
If a name appears at multiple source locations (e.g. `render` defined in five translation units),
each is shown separately with a `[1/5]` prefix.

### `list_zones`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `filter` | string | — | Case-insensitive substring filter |

### `read_trace`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |

Returns file type, compression, stream count, sizes.

### `get_memory_stats`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |

Returns total allocated/freed, current and peak usage, allocation/free counts, and leak count.

### `find_memory_leaks`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `max_leak_size_mb` | number | 1 | Only report leaks larger than this (MB) |
| `max_usage_mb` | number | 100 | Flag if peak usage exceeds this (MB) |

Reports leaks with address and name (if instrumented with `TracyMemPro`),
usage spikes, and fragmentation patterns.

### `list_messages`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `filter` | string | — | Case-insensitive substring filter on message text |
| `severity` | string | `Trace` | Minimum severity: `Trace` `Debug` `Info` `Warning` `Error` `Fatal` |

### `get_frame_stats`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |

Returns per-group: frame count, avg FPS, min/max/avg/P50/P99 frame time, dropped frame count
(frames exceeding 16.667 ms / 60 Hz budget).

### `get_plot_stats`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |

Returns per-plot: min, max, avg, last value, duration of the recording.

### `find_lock_contention`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `min_wait_ms` | number | 0.1 | Only show locks with total wait above this |

Reports lock name (if set with `TracyLockN`), total wait time, worst single wait,
and contention count (number of times a thread had to wait).

### `find_problematic_gpu_zones`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | Path to `.tracy` file |
| `max_avg_time_ms` | number | 5 | Flag GPU zones averaging above this |
| `max_total_time_ms` | number | 50 | Flag GPU zones with total time above this |

---

## Testing

```bash
npm test              # 67 unit + integration tests
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Tests use synthetic event-stream traces — no Tracy installation needed.

---

## License

BSD-3-Clause
