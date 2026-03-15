// Tracy Profiler Demo - Simple C program
// This demonstrates Tracy profiling zones

#include "tracy/TracyC.h"

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// Simulate heavy computation
void heavy_work() {
    TracyCZoneN(ctx, "heavy_work", 1);
    TracyCZoneColor(ctx, 0xFF0000); // Red

    volatile int sum = 0;
    for (int i = 0; i < 50000000; i++) {
        sum += i;
    }

    TracyCZoneEnd(ctx);
}

// Simulate data processing with sub-zones
void process_data() {
    TracyCZoneN(ctx, "process_data", 1);
    TracyCZoneColor(ctx, 0x00FF00); // Green

    // Sub-zone: initialization
    TracyCZoneN(initialize, "initialize", 1);
    usleep(5000); // 5ms
    TracyCZoneEnd(initialize);

    // Sub-zone: processing loop
    TracyCZoneN(processing_loop, "processing_loop", 1);
    TracyCZoneColor(processing_loop, 0xFFFF00);
    for (int i = 0; i < 10; i++) {
        usleep(2000); // 2ms per iteration
    }
    TracyCZoneEnd(processing_loop);

    // Sub-zone: cleanup
    TracyCZoneN(cleanup, "cleanup", 1);
    usleep(3000); // 3ms
    TracyCZoneEnd(cleanup);

    TracyCZoneEnd(ctx);
}

// Fast operation zone
void fast_operation() {
    TracyCZoneN(ctx, "fast_operation", 1);
    TracyCZoneColor(ctx, 0x0000FF); // Blue

    volatile int x = 42;
    for (int i = 0; i < 1000; i++) {
        x = x * 2 + i;
    }

    TracyCZoneEnd(ctx);
}

// Memory allocation demo
void memory_demo() {
    TracyCZoneN(ctx, "memory_demo", 1);

    // Allocate some memory
    void* ptr = malloc(1024 * 100); // 100KB
    TracyCAlloc(ptr, 1024 * 100);

    if (ptr) {
        // Use the memory
        char* buf = (char*)ptr;
        for (int i = 0; i < 1024 * 100; i++) {
            buf[i] = (char)(i % 256);
        }

        free(ptr);
        TracyCFree(ptr);
    }

    TracyCZoneEnd(ctx);
}

// Simulated database query
void db_query() {
    TracyCZoneN(ctx, "database_query", 1);
    TracyCZoneColor(ctx, 0xFF00FF); // Magenta

    // Connection phase
    TracyCZoneN(connect, "connect", 1);
    usleep(10000); // 10ms
    TracyCZoneEnd(connect);

    // Query execution
    TracyCZoneN(execute_query, "execute_query", 1);
    usleep(30000); // 30ms
    TracyCZoneEnd(execute_query);

    // Fetch results
    TracyCZoneN(fetch_results, "fetch_results", 1);
    usleep(15000); // 15ms
    TracyCZoneEnd(fetch_results);

    TracyCZoneEnd(ctx);
}

// Render frame simulation
void render_frame_0() {
    TracyCZoneN(ctx, "frame_0", 1);

    TracyCZoneN(physics_update, "physics_update", 1);
    TracyCZoneColor(physics_update, 0x00FFFF);
    usleep(8000); // 8ms
    TracyCZoneEnd(physics_update);

    TracyCZoneN(culling, "culling", 1);
    TracyCZoneColor(culling, 0xFF8800);
    usleep(3000); // 3ms
    TracyCZoneEnd(culling);

    TracyCZoneN(render, "render", 1);
    TracyCZoneColor(render, 0x8800FF);
    usleep(12000); // 12ms
    TracyCZoneEnd(render);

    TracyCZoneN(present, "present", 1);
    TracyCZoneColor(present, 0x00FF88);
    usleep(2000); // 2ms
    TracyCZoneEnd(present);

    TracyCZoneEnd(ctx);
}

void render_frame_1() {
    TracyCZoneN(ctx, "frame_1", 1);

    TracyCZoneN(physics_update, "physics_update", 1);
    TracyCZoneColor(physics_update, 0x00FFFF);
    usleep(9000);
    TracyCZoneEnd(physics_update);

    TracyCZoneN(culling, "culling", 1);
    TracyCZoneColor(culling, 0xFF8800);
    usleep(4000);
    TracyCZoneEnd(culling);

    TracyCZoneN(render, "render", 1);
    TracyCZoneColor(render, 0x8800FF);
    usleep(14000);
    TracyCZoneEnd(render);

    TracyCZoneN(present, "present", 1);
    TracyCZoneColor(present, 0x00FF88);
    usleep(2000);
    TracyCZoneEnd(present);

    TracyCZoneEnd(ctx);
}

void render_frame_2() {
    TracyCZoneN(ctx, "frame_2", 1);

    TracyCZoneN(physics_update, "physics_update", 1);
    TracyCZoneColor(physics_update, 0x00FFFF);
    usleep(7500);
    TracyCZoneEnd(physics_update);

    TracyCZoneN(culling, "culling", 1);
    TracyCZoneColor(culling, 0xFF8800);
    usleep(2800);
    TracyCZoneEnd(culling);

    TracyCZoneN(render, "render", 1);
    TracyCZoneColor(render, 0x8800FF);
    usleep(11000);
    TracyCZoneEnd(render);

    TracyCZoneN(present, "present", 1);
    TracyCZoneColor(present, 0x00FF88);
    usleep(1900);
    TracyCZoneEnd(present);

    TracyCZoneEnd(ctx);
}

void render_frame_3() {
    TracyCZoneN(ctx, "frame_3", 1);

    TracyCZoneN(physics_update, "physics_update", 1);
    TracyCZoneColor(physics_update, 0x00FFFF);
    usleep(8500);
    TracyCZoneEnd(physics_update);

    TracyCZoneN(culling, "culling", 1);
    TracyCZoneColor(culling, 0xFF8800);
    usleep(3200);
    TracyCZoneEnd(culling);

    TracyCZoneN(render, "render", 1);
    TracyCZoneColor(render, 0x8800FF);
    usleep(13000);
    TracyCZoneEnd(render);

    TracyCZoneN(present, "present", 1);
    TracyCZoneColor(present, 0x00FF88);
    usleep(2100);
    TracyCZoneEnd(present);

    TracyCZoneEnd(ctx);
}

void render_frame_4() {
    TracyCZoneN(ctx, "frame_4", 1);

    TracyCZoneN(physics_update, "physics_update", 1);
    TracyCZoneColor(physics_update, 0x00FFFF);
    usleep(7800);
    TracyCZoneEnd(physics_update);

    TracyCZoneN(culling, "culling", 1);
    TracyCZoneColor(culling, 0xFF8800);
    usleep(2900);
    TracyCZoneEnd(culling);

    TracyCZoneN(render, "render", 1);
    TracyCZoneColor(render, 0x8800FF);
    usleep(11500);
    TracyCZoneEnd(render);

    TracyCZoneN(present, "present", 1);
    TracyCZoneColor(present, 0x00FF88);
    usleep(1800);
    TracyCZoneEnd(present);

    TracyCZoneEnd(ctx);
}

int main() {
    // Main zone
    TracyCZoneN(main_ctx, "main", 1);

    printf("=== Tracy Profiler Demo ===\n");
    printf("This program demonstrates various profiling zones.\n");
    printf("Run Tracy profiler to capture the data!\n\n");

    printf("Running heavy_work()...\n");
    heavy_work();

    printf("Running process_data()...\n");
    process_data();

    printf("Running fast_operation()...\n");
    fast_operation();

    printf("Running memory_demo()...\n");
    memory_demo();

    printf("Running db_query()...\n");
    db_query();

    printf("\nRendering 5 frames...\n");
    render_frame_0();
    render_frame_1();
    render_frame_2();
    render_frame_3();
    render_frame_4();

    printf("\nDemo complete!\n");
    printf("Tracy profiler should show all the zones with timing data.\n");

    TracyCZoneEnd(main_ctx);
    return 0;
}
