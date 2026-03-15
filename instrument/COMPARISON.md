# TracyMemPro vs MemPro - Feature Comparison

## Architecture Comparison

### MemPro Architecture

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Application     │      │  MemPro Library  │      │  MemPro App      │
│                  │      │                  │      │                  │
│ malloc/new  ─────┼─────>│ Hook Allocations ─────>│ Socket/ Dump     │
│ free/delete  ─────┼─────>│ Capture Callstack ─────>│ Leak Analysis    │
│                  │      │ Send Packets     ─────>│ Callstack View   │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

### TracyMemPro Architecture

```
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Application     │      │  TracyMemPro     │      │  Tracy + MCP     │
│                  │      │                  │      │                  │
│ malloc/new  ─────┼─────>│ Hook Allocations ─────>│ Tracy Protocol   │
│ free/delete  ─────┼─────>│ Capture Callstack ─────>│ Tracy Profiler   │
│                  │      │ Send to Tracy    ─────>│ MCP Tools        │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

## Feature Matrix

| Feature | MemPro | TracyMemPro | Notes |
|---------|--------|-------------|-------|
| **Allocation Tracking** |
| Hook operator new/delete | ✅ | ✅ | Both support automatic tracking |
| Hook malloc/free | ✅ | ✅ Via macros | TracyMemPro requires manual macro for malloc |
| Custom allocators | ✅ | ✅ | Via tracking macros |
| **Callstack Capture** |
| Windows | ✅ | ✅ | Via Tracy |
| Linux | ✅ | ✅ | Via Tracy |
| macOS | ✅ | ✅ | Via Tracy |
| Configurable depth | ✅ | ✅ Tracy default | Tracy uses built-in callstack |
| **Data Transmission** |
| Network streaming | ✅ Custom protocol | ✅ Tracy protocol | Tracy uses proven protocol |
| Dump file | ✅ .mempro_dump | ✅ .tracy | Tracy format is standard |
| Real-time view | ✅ | ✅ | Both support live profiling |
| **Leak Detection** |
| Identifies leaks | ✅ | ✅ | Both match alloc/free |
| Shows callstacks | ✅ | ✅ | Tracy shows full stack trace |
| Leak grouping | ✅ | ✅ | Tracy groups by allocation site |
| Leak size | ✅ | ✅ | Tracy shows exact bytes |
| **Analysis Tools** |
| GUI Profiler | ✅ MemPro app | ✅ Tracy Profiler | Tracy has more features |
| CLI/MCP | ❌ | ✅ Tracy MCP | Unique to TracyMemPro |
| Memory timeline | ✅ | ✅ | Tracy shows time-series |
| Memory map | ✅ | ✅ | Tracy shows address space |
| **Integration** |
| C++ | ✅ | ✅ | Native support |
| C | ✅ | ✅ | Via macros |
| Unreal Engine | ✅ Native | ✅ Via Tracy | Tracy has official UE support |
| **Performance** |
| Overhead | Low | Low | Both use efficient ring buffers |
| Zero-cost when off | ✅ | ✅ | Compile-time disabling |
| Async send thread | ✅ | ✅ | Both use background threads |

## Code Comparison

### MemPro Usage

```cpp
#define MEMPRO_ENABLED 1
#include "MemPro.h"

void Example() {
    // Automatic tracking
    char* data = new char[1024];
    delete[] data;

    // Manual tracking
    void* ptr = malloc(1024);
    MEMPRO_TRACK_ALLOC(ptr, 1024);
    MEMPRO_TRACK_FREE(ptr);
    free(ptr);
}
```

### TracyMemPro Usage

```cpp
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"

void Example() {
    // Automatic tracking (same as MemPro)
    char* data = new char[1024];
    delete[] data;

    // Manual tracking (similar syntax)
    void* ptr = malloc(1024);
    TRACY_MEMPRO_ALLOC(ptr, 1024);
    TRACY_MEMPRO_FREE(ptr);
    free(ptr);
}
```

## Leak Detection Output Comparison

### MemPro Output
```
Leaks: 3
Total: 8,388,608 bytes (8 MB)

┌─────────────────────────────────────────────────────────┐
│ Leak #1: 5,242,880 bytes (5 MB)                        │
│ Callstack:                                              │
│   0: operator new                                       │
│   1: Texture::Texture                                   │
│   2: AssetManager::LoadTexture                          │
│   3: main                                              │
└─────────────────────────────────────────────────────────┘
```

### TracyMemPro (via MCP) Output
```
Found 3 memory issue(s):

🔴 #1: LEAK
   Memory leak: 5120.0KB at 0x7f8a4c000000
   💡 Ensure proper deallocation or use smart pointers/RAII

🔴 #2: LEAK
   Memory leak: 2048.0KB at 0x7f8a4c010000
   💡 Ensure proper deallocation or use smart pointers/RAII

🔴 #3: LEAK
   Memory leak: 1228.0KB at 0x7f8a4c018000
   💡 Ensure proper deallocation or use smart pointers/RAII
```

## Unique Advantages

### TracyMemPro Advantages
- **MCP Integration** - Query leaks via LLM/chat interface
- **Tracy Ecosystem** - Leverages Tracy's mature profiling tools
- **CPU + Memory** - Unified profiling in one tool
- **Open Source** - Tracy is fully open source
- **Active Development** - Tracy is actively maintained

### MemPro Advantages
- **Purpose Built** - Focused solely on memory profiling
- **Mature** | - Longer history in game industry
- **Unreal Native** - First-class UE support
- **Dedicated GUI** - Memory-specific interface

## Migration Guide: MemPro → TracyMemPro

| MemPro | TracyMemPro |
|--------|-------------|
| `#define MEMPRO_ENABLED 1` | `#define TRACY_MEMPRO_ENABLE` |
| `#include "MemPro.h"` | `#include "TracyMemPro.hpp"` |
| `MEMPRO_TRACK_ALLOC(p, s)` | `TRACY_MEMPRO_ALLOC(p, s)` |
| `MEMPRO_TRACK_FREE(p)` | `TRACY_MEMPRO_FREE(p)` |
| `MemProApp.exe` | Tracy Profiler GUI |
| `.mempro_dump` file | `.tracy` file |
| Manual leak detection | `find_memory_leaks()` MCP tool |

## When to Use Which

### Use TracyMemPro when:
- You already use Tracy for CPU profiling
- You want LLM-assisted memory analysis
- You need open source solution
- You're building from source anyway

### Use MemPro when:
- You need dedicated memory profiling only
- You're in Unreal Engine (native support)
- You prefer a specialized memory tool
- You have existing MemPro workflow
