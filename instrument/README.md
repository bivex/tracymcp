# TracyMemPro — automatic new/delete tracking for Tracy

Drop-in header that hooks `operator new` and `operator delete` globally so every
heap allocation in your program is automatically reported to Tracy Profiler.
No need to sprinkle `TracyAlloc`/`TracyFree` at every callsite.

Designed for debug builds. Zero overhead when disabled.

---

## Quick start

Add two defines before the include in **one** `.cpp` file (e.g. `main.cpp`):

```cpp
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"
```

That's it. Every subsequent `new`/`delete` anywhere in your program is now
tracked. Run your app with tracy-capture running, save the trace, then:

```
find_memory_leaks(path="my_trace.tracy", max_leak_size_mb=0.1)
```

---

## Build

```bash
# Minimal — link against TracyClient (shared or static)
g++ -std=c++17 -O2 \
    -DTRACY_MEMPRO_ENABLE -DTRACY_MEMPRO_OVERRIDE_NEW_DELETE \
    -DTRACY_ENABLE \
    -I/path/to/tracy/public \
    main.cpp -o my_app \
    -L/path/to/tracy/build -lTracyClient -lpthread -ldl

# Or with CMake — just add to your target:
target_compile_definitions(my_app PRIVATE
    TRACY_ENABLE
    TRACY_MEMPRO_ENABLE
    TRACY_MEMPRO_OVERRIDE_NEW_DELETE
)
target_include_directories(my_app PRIVATE /path/to/tracy/tracymcp/instrument)
```

Debug builds only — add a guard in your CMakeLists:

```cmake
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    target_compile_definitions(my_app PRIVATE
        TRACY_ENABLE TRACY_MEMPRO_ENABLE TRACY_MEMPRO_OVERRIDE_NEW_DELETE)
endif()
```

---

## Debugging a memory leak step by step

### 1. Reproduce the leak

Run your app normally. If you already know "memory grows over time" or
"valgrind says X bytes leaked" — that's your reproduction case.

### 2. Capture a trace

```bash
# Terminal 1
tracy-capture -o leak_hunt.tracy -f

# Terminal 2 — run the scenario that produces the leak
./my_app --scenario load-and-unload-assets
```

### 3. Ask Claude to find the leaks

```
find_memory_leaks(path="leak_hunt.tracy", max_leak_size_mb=0.064)
```

Output with TracyMemPro names attached:

```
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

The name in parentheses comes from `TRACY_MEMPRO_ALLOC_NAMED` (see below).
Without it you still get the address, which you can look up in the Tracy GUI.

### 4. Narrow down with named allocations

Once you know which subsystem leaks, add names to its allocator:

```cpp
// Before (anonymous):
void* Texture::AllocPixelData(size_t bytes) {
    return ::operator new(bytes);
}

// After (named — shows up in MCP output):
void* Texture::AllocPixelData(size_t bytes) {
    void* p = ::operator new(bytes);
    TRACY_MEMPRO_ALLOC_NAMED(p, bytes, "TextureCache");
    return p;
}
void Texture::FreePixelData(void* p) {
    TRACY_MEMPRO_FREE(p);
    ::operator delete(p);
}
```

---

## API

### Global new/delete hooks (automatic, opt-in)

```cpp
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
```

Overrides `operator new`, `operator new[]`, `operator delete`, `operator delete[]`
globally. Every allocation ≥ `TRACY_MEMPRO_MIN_ALLOC_SIZE` (default: 64 bytes)
is reported to Tracy.

### Manual tracking for custom allocators

```cpp
// Track a raw malloc / custom allocator
void* p = my_pool.Alloc(size);
TRACY_MEMPRO_ALLOC(p, size);          // anonymous
TRACY_MEMPRO_ALLOC_NAMED(p, size, "MyPool");  // with name

// Track the free
my_pool.Free(p);
TRACY_MEMPRO_FREE(p);
```

### Named allocation RAII helper

Tracks allocation on construction, free on destruction:

```cpp
{
    TRACY_MEMPRO_SCOPE(tracker, buffer, 1024 * 1024);
    // buffer is tracked as long as tracker is alive
}   // automatically reports free here
```

### C++ class-level tracking

Override `operator new`/`delete` for a specific class only:

```cpp
class Texture {
public:
    void* operator new(size_t size) {
        void* p = ::operator new(size);
        TracyMemPro::TrackAlloc(p, size, "Texture");
        return p;
    }
    void operator delete(void* p) noexcept {
        TracyMemPro::TrackFree(p);
        ::operator delete(p);
    }
};
```

---

## Configuration

Set these before including `TracyMemPro.hpp`:

| Macro | Default | Description |
|-------|---------|-------------|
| `TRACY_MEMPRO_ENABLE` | (unset) | Must be defined to enable anything |
| `TRACY_MEMPRO_OVERRIDE_NEW_DELETE` | (unset) | Hook global `new`/`delete` |
| `TRACY_MEMPRO_MIN_ALLOC_SIZE` | `64` | Ignore allocations smaller than this (bytes) |
| `TRACY_MEMPRO_CALLSTACK_DEPTH` | (unset) | Capture N frames of callstack per alloc |

#### Callstack capture

Callstacks let you see exactly which function allocated the leaked memory.
They add overhead — only use in debug:

```cpp
#define TRACY_MEMPRO_CALLSTACK_DEPTH 16   // capture 16 frames
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#include "TracyMemPro.hpp"
```

#### Tracking only large allocations

To reduce noise from small allocations (strings, small containers):

```cpp
#define TRACY_MEMPRO_MIN_ALLOC_SIZE 4096  // only track ≥ 4 KB
```

---

## Common patterns and bugs it finds

### Forgotten destructor / missing delete

```cpp
class ResourceManager {
    std::vector<Texture*> textures;
public:
    void Load(const char* path) {
        textures.push_back(new Texture(path));  // tracked
    }
    ~ResourceManager() {
        // forgot to delete textures — MCP finds this
    }
};
```

### Circular shared_ptr (reference cycle)

```cpp
struct Node {
    std::shared_ptr<Node> next;
    std::shared_ptr<Node> prev;
};
auto a = std::make_shared<Node>();
auto b = std::make_shared<Node>();
a->next = b;
b->prev = a;
// Both ref counts stay at 1 — memory never freed — MCP finds this
```

### Early-return skips free

```cpp
void ProcessRequest(Request* req) {
    char* buf = new char[64 * 1024];   // tracked

    if (!Validate(req)) return;        // BUG: buf leaks here

    Process(buf, req);
    delete[] buf;
}
```

### Producer/consumer imbalance

```cpp
// Producer thread keeps going after consumer exits
while (running) {
    auto* pkt = new Packet(read_socket());
    queue.push(pkt);    // tracked — but if consumer died, pkt never freed
}
```

---

## Combining with CPU zone profiling

Tracy memory and CPU tracking work together in the same trace:

```cpp
void LoadLevel(const char* name) {
    ZoneScopedN("LoadLevel");            // CPU timing zone

    auto* mesh = new Mesh(name);         // memory tracked automatically
    auto* shader = new Shader("pbr");    // memory tracked automatically

    TRACY_MEMPRO_ALLOC_NAMED(mesh->vbo, mesh->vbo_size, "VBO");
}
```

Then in a single trace you can see both where time is spent and where memory
is allocated, and Claude can correlate them:

```
# Both tools on the same trace:
find_problematic_zones(path="trace.tracy")
find_memory_leaks(path="trace.tracy", max_leak_size_mb=0.1)
```

---

## Troubleshooting

**No allocations appearing in Tracy / MCP output**
- Check `TRACY_MEMPRO_ENABLE` is defined before the include
- Check Tracy Profiler is connected before your app starts allocating
- Verify allocations exceed `TRACY_MEMPRO_MIN_ALLOC_SIZE`
- Make sure you're not running a Release build that strips Tracy

**Multiple definition errors at link time**
- Include `TracyMemPro.hpp` in exactly **one** `.cpp` file
- In all other files that need the macros, include it without the defines:
  ```cpp
  // other_file.cpp — just the macros, no operator new/delete override
  #include "TracyMemPro.hpp"
  ```

**Callstacks missing or truncated**
- Build Tracy with `TRACY_HAS_CALLSTACK` defined (enabled by default on Linux/macOS)
- Increase `TRACY_MEMPRO_CALLSTACK_DEPTH`
- Build with `-g` and without `-fomit-frame-pointer`

**My custom allocator bypasses the hooks**
- `TRACY_MEMPRO_OVERRIDE_NEW_DELETE` only intercepts `operator new`/`delete`
- For `malloc`/`free` or arena allocators, add `TRACY_MEMPRO_ALLOC` / `TRACY_MEMPRO_FREE` manually

---

## Demo

```bash
cd tracymcp/instrument
make                 # build demo_mempro binary
make run             # run it (requires tracy-capture in another terminal)
```

`demo_mempro.cpp` demonstrates intentional leaks (texture cache, raw allocations),
correct RAII usage, smart pointers, and container allocations — useful as a
reference for what the MCP output looks like for each pattern.

---

## License

BSD-3-Clause (same as Tracy)
