# TracyMemPro - MemPro-style Memory Instrumentation for Tracy

MemPro-inspired automatic memory leak detection and profiling for Tracy Profiler.

## Features

- **Automatic Allocation Tracking** - Override `operator new/delete` to track all allocations
- **Callstack Capture** - See exactly where each allocation happened
- **Leak Detection** - Find memory leaks via Tracy Profiler or Tracy MCP server
- **Zero Overhead When Disabled** - Compile-time instrumentation with stub implementations
- **Compatible with Tracy** - Uses existing Tracy memory profiling macros

## Quick Start

### 1. Basic Usage

```cpp
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"

int main() {
    // All new/delete are now tracked automatically
    int* data = new int[1000];  // Tracked with callstack
    delete[] data;              // Tracked

    // Named allocations
    TracyMemPro::TrackAlloc(buffer, size, "MyBuffer");
    TracyMemPro::TrackFree(buffer);

    return 0;
}
```

### 2. Manual Tracking

For custom allocators or non-C++ allocations:

```cpp
void* ptr = malloc(1024);
TRACY_MEMPRO_ALLOC(ptr, 1024);  // Track with name "ptr"
TRACY_MEMPRO_FREE(ptr);
free(ptr);
```

### 3. Named Allocations

```cpp
Texture* tex = malloc(sizeof(Texture));
TRACY_MEMPRO_ALLOC_NAMED(tex, sizeof(Texture), "Texture:grass.png");
```

## Configuration Options

| Macro | Default | Description |
|-------|---------|-------------|
| `TRACY_MEMPRO_ENABLE` | `0` | Enable instrumentation (set to 1) |
| `TRACY_MEMPRO_OVERRIDE_NEW_DELETE` | `0` | Override global new/delete |
| `TRACY_MEMPRO_MIN_ALLOC_SIZE` | `64` | Only track allocations ≥ this size |

## Building

```bash
# Build the demo
make

# Run with Tracy Profiler
make run
```

## Analyzing Results

### Via Tracy Profiler GUI

1. Run your application with Tracy Profiler connected
2. Check the **Memory** tab for allocations and leaks
3. Click on allocations to see callstacks

### Via Tracy MCP Server

```bash
# After saving your trace as my_app.tracy

# Get memory statistics
get_memory_stats(path="my_app.tracy")

# Find leaks
find_memory_leaks(path="my_app.tracy", max_leak_size_mb=0.1)
```

Output:
```
Found 5 memory issue(s):

🔴 #1: LEAK
   Memory leak: 4096.0KB at 0x7f8a4c000000
   Callstack: operator new → Texture::Texture → LoadTexture
   💡 Ensure proper deallocation or use smart pointers/RAII
```

## How It Works

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  Application    │      │  TracyMemPro     │      │  Tracy Profiler │
│                 │      │                  │      │                 │
│ new/delete  ────┼─────>│ TrackAlloc/Free  ─────>│ Memory Events   │
│ malloc/calloc  ──┼─────>│ Capture Callstack ─────>│ Leak Detection  │
│ custom alloc   ───┼────>│ Send to Profiler ─────>│ Callstack View  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

### Memory Leak Detection Flow

1. **Allocation**: `operator new` → `TrackAlloc()` → Tracy captures address + size + callstack
2. **Deallocation**: `operator delete` → `TrackFree()` → Tracy marks address as freed
3. **Analysis**: Tracy matches allocs with frees; unmatched = leak
4. **Reporting**: View leaks with full callstacks in Profiler or via MCP tools

## Comparison with MemPro

| Feature | TracyMemPro | MemPro |
|---------|-------------|--------|
| Callstack capture | ✅ Tracy built-in | ✅ Custom implementation |
| Network streaming | ✅ Tracy protocol | ✅ Custom protocol |
| Dump file support | ✅ .tracy format | ✅ .mempro_dump |
| Profiler UI | ✅ Tracy Profiler | ✅ MemPro app |
| MCP Integration | ✅ Yes | ❌ No |
| License | BSD-3-Clause | Custom |

## Advanced Usage

### Tracking Specific Allocators

```cpp
class MyAllocator {
    void* Allocate(size_t size) {
        void* ptr = malloc(size);
        TRACY_MEMPRO_ALLOC_NAMED(ptr, size, "MyAllocator");
        return ptr;
    }

    void Free(void* ptr) {
        TRACY_MEMPRO_FREE(ptr);
        free(ptr);
    }
};
```

### RAII Helper

```cpp
{
    TRACY_MEMPRO_SCOPE(tracker, buffer, 1024);
    // buffer is tracked here
    // automatically freed when scope ends
}
```

### Disabling Tracking for Specific Allocations

```cpp
// Allocations < 64 bytes are ignored by default
// Change with TRACY_MEMPRO_MIN_ALLOC_SIZE

// Or track manually only what you need
#undef TRACY_MEMPRO_OVERRIDE_NEW_DELETE
```

## Demo Applications

### `demo_mempro.cpp`

Demonstrates:
- ✅ Intentional leaks (textures, meshes, raw allocations)
- ✅ Proper memory management (RAII, smart pointers)
- ✅ Temporary allocations
- ✅ Container allocations

Run with `make run` and capture in Tracy Profiler.

## Tips and Best Practices

1. **Enable in Debug Builds Only**
   ```makefile
   DEBUG_CXXFLAGS += -DTRACY_MEMPRO_ENABLE -DTRACY_MEMPRO_OVERRIDE_NEW_DELETE
   ```

2. **Set Appropriate Minimum Size**
   - Small allocations (< 64 bytes) create overhead
   - Adjust `TRACY_MEMPRO_MIN_ALLOC_SIZE` based on your needs

3. **Use Named Allocations for Better Diagnostics**
   ```cpp
   // Instead of:
   new Texture();

   // Use:
   TRACY_MEMPRO_ALLOC_NAMED(ptr, size, "Texture:grass.png");
   ```

4. **Combine with Zone Profiling**
   ```cpp
   void LoadAssets() {
       ZoneScoped;  // CPU timing
       // Memory tracking happens automatically
   }
   ```

## Troubleshooting

### No allocations appearing
- Ensure `TRACY_MEMPRO_ENABLE` is defined
- Check Tracy Profiler is connected
- Verify allocations exceed `TRACY_MEMPRO_MIN_ALLOC_SIZE`

### Missing callstacks
- Ensure Tracy is built with callstack support
- Check `TRACY_HAS_CALLSTACK` is defined
- Try increasing callstack depth

### Build errors
- Link against TracyClient library
- Include Tracy headers: `-I/path/to/tracy/public`
- Use C++17 or later: `-std=c++17`

## License

BSD-3-Clause (same as Tracy)
