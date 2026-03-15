/**
 * Standalone TracyMemPro Demo
 *
 * Minimal demo that can be compiled and linked with Tracy client library.
 * This demonstrates the instrumentation without requiring full project setup.
 */

// Enable TracyMemPro instrumentation
#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE

// Tracy headers - adjust path as needed
#include "tracy/Tracy.hpp"

// Include TracyMemPro after Tracy
#include "TracyMemPro.hpp"

#include <iostream>
#include <vector>
#include <string>

void SimpleLeakDemo() {
    ZoneScopedN("SimpleLeakDemo");

    std::cout << "Creating intentional leaks...\n";

    // These will show up as leaks in Tracy
    char* leak1 = new char[1024 * 1024];     // 1 MB
    char* leak2 = new char[2 * 1024 * 1024];  // 2 MB
    char* leak3 = new char[5 * 1024 * 1024];  // 5 MB

    std::cout << "Leaked 8 MB total\n";
    std::cout << "Check Tracy Profiler Memory tab\n";
}

void ProperCleanupDemo() {
    ZoneScopedN("ProperCleanupDemo");

    std::cout << "Proper allocation and cleanup...\n";

    for (int i = 0; i < 100; i++) {
        // These allocations will be freed
        std::vector<char> buffer(1024);
        buffer[0] = 'X';
    }

    std::cout << "Completed 100 allocations with proper cleanup\n";
}

void ManualTrackingDemo() {
    ZoneScopedN("ManualTrackingDemo");

    std::cout << "Manual memory tracking...\n";

    // Manual allocation tracking
    void* customAlloc = malloc(10 * 1024 * 1024);  // 10 MB
    TRACY_MEMPRO_ALLOC_NAMED(customAlloc, 10 * 1024 * 1024, "CustomBuffer");

    // Do something with the memory
    memset(customAlloc, 0xAB, 10 * 1024 * 1024);

    // This will leak (no free)
    // TRACY_MEMPRO_FREE(customAlloc);
    // free(customAlloc);

    std::cout << "Created 10 MB manual allocation (will leak)\n";
}

int main() {
    ZoneScopedN("main");

    std::cout << "========================================\n";
    std::cout << "TracyMemPro Standalone Demo\n";
    std::cout << "========================================\n\n";

    std::cout << "Make sure Tracy Profiler is running!\n\n";

    ProperCleanupDemo();
    ManualTrackingDemo();
    SimpleLeakDemo();

    std::cout << "\n========================================\n";
    std::cout << "Demo Complete!\n";
    std::cout << "========================================\n\n";

    std::cout << "Next steps:\n";
    std::cout << "1. Check Tracy Profiler Memory tab\n";
    std::cout << "2. Save trace as .tracy file\n";
    std::cout << "3. Analyze with: find_memory_leaks(path=\"trace.tracy\")\n";

    return 0;
}
