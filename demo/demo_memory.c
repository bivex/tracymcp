// Tracy Profiler Demo with Memory Profiling
// Compile with: gcc -o demo_memory demo_memory.c -I../../public/common -I../../public/client -L../../build -lTracyClient -lpthread -ldl
// Or link against libTracyClient.a if available

#define TRACY_ENABLE
#include "tracy/Tracy.hpp"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// Simulate a texture cache that leaks memory
typedef struct {
    char* data;
    size_t size;
    int width;
    int height;
} Texture;

// Properly free a texture and report to Tracy
void free_texture(Texture* tex) {
    ZoneScoped;

    if (!tex) return;

    if (tex->data) {
        free(tex->data);
        TracyFree(tex->data);
        tex->data = NULL;
    }

    TracyFree(tex);
    free(tex);
}

Texture* load_texture(int width, int height) {
    ZoneScoped;

    const size_t size = width * height * 4; // RGBA
    char* data = (char*)malloc(size);
    if (!data) return NULL;

    // Initialize with pattern
    for (size_t i = 0; i < size; i++) {
        data[i] = (char)(i % 256);
    }

    Texture* tex = (Texture*)malloc(sizeof(Texture));
    if (!tex) {
        free(data);
        return NULL;
    }

    tex->data = data;
    tex->size = size;
    tex->width = width;
    tex->height = height;

    TracyAlloc(tex, sizeof(Texture));
    TracyAllocN(tex->data, tex->size, "texture_data");

    return tex;
}

// Intentionally leak textures (for testing memory leak detection)
void leak_some_textures() {
    ZoneScoped;

    for (int i = 0; i < 5; i++) {
        char name[64];
        snprintf(name, sizeof(name), "leaked_texture_%d", i);

        Texture* tex = load_texture(256, 256);
        if (tex) {
            printf("Loaded texture %s: %zu bytes\n", name, tex->size);
            // Textures are now properly freed, so they won't leak
            free_texture(tex);
        }
    }
}

// Proper memory management
void proper_memory_usage() {
    ZoneScoped;

    char* buffer = (char*)malloc(1024 * 100); // 100KB
    TracyAlloc(buffer, 1024 * 100);

    if (buffer) {
        memset(buffer, 0xAA, 1024 * 100);
        usleep(5000); // 5ms
        free(buffer);
        TracyFree(buffer);
    }
}

// High allocation frequency (for testing fragmentation detection)
void high_frequency_allocations() {
    ZoneScoped;

    for (int i = 0; i < 100; i++) {
        void* ptr = malloc(64); // Small allocations
        TracyAlloc(ptr, 64);

        // Do some work
        volatile int x = 0;
        for (int j = 0; j < 100; j++) {
            x += j;
        }

        free(ptr);
        TracyFree(ptr);
    }
}

// Large allocation (for testing spike detection)
void large_allocation() {
    ZoneScoped;

    const size_t largeSize = 10 * 1024 * 1024; // 10MB
    void* ptr = malloc(largeSize);
    TracyAlloc(ptr, largeSize);

    if (ptr) {
        memset(ptr, 0x42, largeSize);
        usleep(10000); // 10ms
        free(ptr);
        TracyFree(ptr);
    }
}

// Memory pool simulation
typedef struct {
    void* blocks[10];
    size_t block_size;
    int count;
} MemoryPool;

MemoryPool* create_pool(size_t block_size) {
    ZoneScopedN(__FUNCTION__);

    MemoryPool* pool = (MemoryPool*)malloc(sizeof(MemoryPool));
    pool->block_size = block_size;
    pool->count = 0;
    TracyAlloc(pool, sizeof(MemoryPool));

    return pool;
}

void pool_alloc(MemoryPool* pool) {
    ZoneScopedN(__FUNCTION__);

    if (pool->count < 10) {
        void* block = malloc(pool->block_size);
        TracyAllocN(block, pool->block_size, "pool_block");
        pool->blocks[pool->count++] = block;
    }
}

void cleanup_pool(MemoryPool* pool) {
    ZoneScopedN(__FUNCTION__);

    for (int i = 0; i < pool->count; i++) {
        if (pool->blocks[i]) {
            free(pool->blocks[i]);
            TracyFree(pool->blocks[i]);
        }
    }
    free(pool);
    TracyFree(pool);
}

// Memory spike simulation
void memory_spike_demo() {
    ZoneScopedN(__FUNCTION__);

    // Allocate a bunch of memory temporarily
    void* pointers[20];
    size_t total = 0;

    for (int i = 0; i < 20; i++) {
        const size_t alloc_size = 1024 * 1024; // 1MB each
        pointers[i] = malloc(alloc_size);
        TracyAlloc(pointers[i], alloc_size);
        total += alloc_size;

        if (pointers[i]) {
            memset(pointers[i], 0xBB, alloc_size);
        }
    }

    printf("Allocated %zu MB temporarily\n", total / (1024 * 1024));

    // Hold it briefly
    usleep(5000); // 5ms

    // Free everything
    for (int i = 0; i < 20; i++) {
        if (pointers[i]) {
            free(pointers[i]);
            TracyFree(pointers[i]);
        }
    }
}

int main() {
    ZoneScopedN("main");

    printf("=== Tracy Memory Profiling Demo ===\n");
    printf("This demo demonstrates various memory patterns.\n");
    printf("Run Tracy Profiler to capture the data!\n\n");

    printf("1. Leaking textures (5x 256KB textures)...\n");
    leak_some_textures();

    printf("\n2. Proper memory usage (100KB alloc/free)...\n");
    proper_memory_usage();

    printf("\n3. High frequency allocations (100x 64-byte allocs)...\n");
    high_frequency_allocations();

    printf("\n4. Large allocation (10MB)...\n");
    large_allocation();

    printf("\n5. Memory pool simulation...\n");
    MemoryPool* pool = create_pool(1024 * 1024); // 1MB blocks
    for (int i = 0; i < 5; i++) {
        pool_alloc(pool);
    }
    cleanup_pool(pool);

    printf("\n6. Memory spike demo (20MB temporary allocation)...\n");
    memory_spike_demo();

    printf("\n=== Demo Complete ===\n");
    printf("Check Tracy Profiler for:\n");
    printf("  - Memory timeline\n");
    printf("  - Active allocations (leaks!)\n");
    printf("  - Memory map\n");

    return 0;
}
