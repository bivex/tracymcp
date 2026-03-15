/**
 * TracyMemPro - MemPro-style instrumentation for Tracy Profiler
 *
 * Features:
 * - Automatic memory allocation tracking via operator new/delete override
 * - Callstack capture for each allocation
 * - Leak detection via Tracy Profiler
 * - Compatible with existing Tracy macros
 *
 * Usage:
 *   1. #define TRACY_MEMPRO_ENABLE before including this header
 *   2. Link with TracyClient library
 *   3. Run your app and capture trace in Tracy Profiler
 *   4. Use Tracy MCP server: find_memory_leaks(path="trace.tracy")
 */

#ifndef TRACY_MEMPRO_H
#define TRACY_MEMPRO_H

// Configuration
#ifndef TRACY_MEMPRO_MIN_ALLOC_SIZE
    #define TRACY_MEMPRO_MIN_ALLOC_SIZE 64  // Only track allocs >= 64 bytes
#endif

// Enable Tracy and set up memory profiling
#if defined(TRACY_MEMPRO_ENABLE)

    // Ensure Tracy is enabled
    #ifndef TRACY_ENABLE
        #define TRACY_ENABLE
    #endif

    #include "tracy/Tracy.hpp"
    #include <cstddef>
    #include <cstdlib>

    namespace TracyMemPro {
        // Initialize the instrumentation (optional, for future use)
        inline void Initialize() {}

        // Track allocation with callstack
        inline void TrackAlloc(void* ptr, size_t size, const char* name = nullptr) {
            if (ptr && size >= TRACY_MEMPRO_MIN_ALLOC_SIZE) {
                if (name) {
                    TracyAllocNS(ptr, size, TRACY_CALLSTACK, name);
                } else {
                    TracyAllocS(ptr, size, TRACY_CALLSTACK);
                }
            }
        }

        // Track deallocation
        inline void TrackFree(void* ptr) {
            if (ptr) {
                TracyFree(ptr);
            }
        }

        // RAII helper for named allocations
        class ScopedAllocation {
        public:
            ScopedAllocation(void* ptr, size_t size, const char* name)
                : m_ptr(ptr) {
                TrackAlloc(ptr, size, name);
            }

            ~ScopedAllocation() {
                TrackFree(m_ptr);
            }

        private:
            void* m_ptr;
        };
    }

    // Override global new/delete if enabled
    #ifdef TRACY_MEMPRO_OVERRIDE_NEW_DELETE

        // Normal new/delete
        void* operator new(size_t size) {
            void* ptr = malloc(size);
            if (ptr) {
                TracyMemPro::TrackAlloc(ptr, size, "operator new");
            }
            return ptr;
        }

        void operator delete(void* ptr) noexcept {
            if (ptr) {
                TracyMemPro::TrackFree(ptr);
                free(ptr);
            }
        }

        void* operator new[](size_t size) {
            void* ptr = malloc(size);
            if (ptr) {
                TracyMemPro::TrackAlloc(ptr, size, "operator new[]");
            }
            return ptr;
        }

        void operator delete[](void* ptr) noexcept {
            if (ptr) {
                TracyMemPro::TrackFree(ptr);
                free(ptr);
            }
        }

        // Sized delete (C++14)
        void operator delete(void* ptr, size_t) noexcept {
            if (ptr) {
                TracyMemPro::TrackFree(ptr);
                free(ptr);
            }
        }

        void operator delete[](void* ptr, size_t) noexcept {
            if (ptr) {
                TracyMemPro::TrackFree(ptr);
                free(ptr);
            }
        }

    #endif // TRACY_MEMPRO_OVERRIDE_NEW_DELETE

    // Manual tracking macros for non-automatic allocations
    #define TRACY_MEMPRO_ALLOC(ptr, size) \
        TracyMemPro::TrackAlloc(ptr, size, #ptr)

    #define TRACY_MEMPRO_ALLOC_NAMED(ptr, size, name) \
        TracyMemPro::TrackAlloc(ptr, size, name)

    #define TRACY_MEMPRO_FREE(ptr) \
        TracyMemPro::TrackFree(ptr)

    // RAII helper macro
    #define TRACY_MEMPRO_SCOPE(var, ptr, size) \
        auto var = TracyMemPro::ScopedAllocation(ptr, size, #ptr)

#else // TRACY_MEMPRO_ENABLE not set or disabled

    #include <cstddef>

    // Stub implementations when disabled
    namespace TracyMemPro {
        inline void Initialize() {}
        inline void TrackAlloc(void*, size_t, const char* = nullptr) {}
        inline void TrackFree(void*) {}
    }

    #define TRACY_MEMPRO_ALLOC(ptr, size) ((void)0)
    #define TRACY_MEMPRO_ALLOC_NAMED(ptr, size, name) ((void)0)
    #define TRACY_MEMPRO_FREE(ptr) ((void)0)

#endif // TRACY_MEMPRO_ENABLE

#endif // TRACY_MEMPRO_H
