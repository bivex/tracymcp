/**
 * Test stub version of TracyMemPro (without Tracy dependency)
 * This verifies the basic structure works correctly.
 */

// Define this to DISABLE TracyMemPro (test stubs)
#undef TRACY_MEMPRO_ENABLE

#include "TracyMemPro.hpp"
#include <iostream>
#include <cstdlib>

void TestBasicOperations() {
    std::cout << "Testing TracyMemPro stub (disabled)...\n";

    // These should compile to no-ops
    TracyMemPro::Initialize();
    TracyMemPro::TrackAlloc(nullptr, 100);
    TracyMemPro::TrackAlloc(nullptr, 1000, "TestAlloc");
    TracyMemPro::TrackFree(nullptr);

    // Macros should also be no-ops
    void* ptr = malloc(1024);
    TRACY_MEMPRO_ALLOC(ptr, 1024);
    TRACY_MEMPRO_ALLOC_NAMED(ptr, 1024, "NamedAlloc");
    TRACY_MEMPRO_FREE(ptr);
    free(ptr);

    std::cout << "✓ Stub operations compiled successfully\n";
}

void TestDisabledCompile() {
    std::cout << "\nTesting that disabled version compiles...\n";

    // These should all compile without Tracy (since TRACY_MEMPRO_ENABLE is not defined)
    int* data = new int[100];
    delete[] data;

    char* buffer = new char[1024];
    delete[] buffer;

    std::cout << "✓ New/delete compiled without Tracy\n";
}

int main() {
    std::cout << "========================================\n";
    std::cout << "TracyMemPro Stub Test\n";
    std::cout << "========================================\n\n";

    TestBasicOperations();
    TestDisabledCompile();

    std::cout << "\n========================================\n";
    std::cout << "All tests passed! ✓\n";
    std::cout << "========================================\n\n";

    std::cout << "Note: To test full functionality:\n";
    std::cout << "1. Install Tracy Profiler\n";
    std::cout << "2. Define TRACY_MEMPRO_ENABLE=1\n";
    std::cout << "3. Link with TracyClient library\n";

    return 0;
}
