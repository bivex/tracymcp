# TracyMemPro Quick Reference

## Setup (One-time)

```cpp
// Add to your main.cpp or common header
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"
```

## Build Command

```bash
g++ -o app main.cpp \
    -I/path/to/tracy/public \
    -L/path/to/tracy/build -lTracyClient \
    -DTRACY_ENABLE \
    -lpthread -ldl -lstdc++
```

## Common Patterns

### 1. Automatic Tracking (Recommended)
```cpp
// Just use new/delete normally - automatically tracked!
MyClass* obj = new MyClass();
delete obj;
```

### 2. Named Allocations
```cpp
// For better diagnostics, name your allocations
Texture* tex = new Texture();
TRACY_MEMPRO_ALLOC_NAMED(tex, sizeof(Texture), "Texture:grass.png");
```

### 3. Manual malloc/free Tracking
```cpp
void* ptr = malloc(size);
TRACY_MEMPRO_ALLOC(ptr, size);
// ... use ptr ...
TRACY_MEMPRO_FREE(ptr);
free(ptr);
```

### 4. Temporary Allocations (No Leak)
```cpp
{
    std::vector<char> buffer(1024);
    // Freed when scope ends
}
```

### 5. Intentional Leak (For Testing)
```cpp
void* leak = malloc(1024);  // Will show as leak
// Don't call TRACY_MEMPRO_FREE or free()
```

## MCP Commands

```bash
# After capturing trace as myapp.tracy:

# Get statistics
get_memory_stats(path="myapp.tracy")

# Find leaks > 1MB
find_memory_leaks(path="myapp.tracy", max_leak_size_mb=1)

# Find leaks with custom thresholds
find_memory_leaks(path="myapp.tracy", max_leak_size_mb=0.1, max_usage_mb=50)
```

## Expected Output

```
Memory Statistics
==================
Total Allocated: 125.50 MB
Total Freed: 110.25 MB
Current Usage: 15.25 MB
Peak Usage: 45.00 MB
Allocations: 1,250
Frees: 1,247
Potential Leaks: 3

Found 3 memory issue(s):

🔴 #1: LEAK
   Memory leak: 5120.0KB at 0x7f8a4c000000
   💡 Ensure proper deallocation or use smart pointers/RAII

🟡 #2: HIGH-USAGE
   High memory usage: 15.25 MB
   💡 Consider memory pooling, reducing allocation sizes...
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No allocations shown | Check Tracy Profiler is connected |
| Missing callstacks | Ensure TRACY_HAS_CALLSTACK defined |
| Build errors | Link with TracyClient library |
| Too much overhead | Increase TRACY_MEMPRO_MIN_ALLOC_SIZE |

## Configuration

```cpp
// In build script or before include
#define TRACY_MEMPRO_MIN_ALLOC_SIZE 64   // Track only >= 64B
#define TRACY_MEMPRO_CALLSTACK_DEPTH 16  // Callstack frames
```
