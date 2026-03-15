/**
 * TracyMemPro Demo
 *
 * Demonstrates MemPro-style memory leak detection using Tracy
 *
 * Build:
 *   g++ -o demo_mempro demo_mempro.cpp \
 *       -I/path/to/tracy/public \
 *       -L/path/to/tracy/build -lTracyClient \
 *       -DTRACY_MEMPRO_ENABLE -DTRACY_MEMPRO_OVERRIDE_NEW_DELETE \
 *       -lpthread -ldl -lstdc++
 *
 * Usage:
 *   ./demo_mempro
 *   # Trace will be captured by Tracy Profiler
 *   # Save trace and analyze with: find_memory_leaks(path="trace.tracy")
 */

#define TRACY_MEMPRO_ENABLE
#define TRACY_MEMPRO_OVERRIDE_NEW_DELETE
#define TRACY_MEMPRO_CALLSTACK_DEPTH 16

#include "TracyMemPro.hpp"

#include <iostream>
#include <vector>
#include <memory>
#include <string>
#include <map>

// Simulate a texture resource
class Texture {
public:
    Texture(int width, int height, const std::string& name)
        : m_width(width), m_height(height), m_name(name) {
        m_data = new char[width * height * 4];
        std::cout << "Created texture: " << m_name << " (" << (width * height * 4) << " bytes)\n";
    }

    ~Texture() {
        delete[] m_data;
        std::cout << "Destroyed texture: " << m_name << "\n";
    }

private:
    char* m_data;
    int m_width;
    int m_height;
    std::string m_name;
};

// Simulate a mesh resource
class Mesh {
public:
    Mesh(size_t vertexCount, const std::string& name)
        : m_name(name), m_vertexCount(vertexCount) {
        m_vertices = new float[vertexCount * 3]; // x, y, z
        std::cout << "Created mesh: " << m_name << " (" << (vertexCount * 3 * 4) << " bytes)\n";
    }

    ~Mesh() {
        delete[] m_vertices;
        std::cout << "Destroyed mesh: " << m_name << "\n";
    }

private:
    float* m_vertices;
    std::string m_name;
    size_t m_vertexCount;
};

// Resource manager that intentionally leaks
class ResourceManager {
public:
    Texture* LoadTexture(int width, int height, const std::string& name) {
        ZoneScoped;
        auto tex = new Texture(width, height, name);
        m_textures.push_back(tex);
        return tex;
    }

    Mesh* LoadMesh(size_t vertexCount, const std::string& name) {
        ZoneScoped;
        auto mesh = new Mesh(vertexCount, name);
        m_meshes.push_back(mesh);
        return mesh;
    }

    // Intentionally don't clean up - simulating leak
    ~ResourceManager() {
        std::cout << "ResourceManager destroyed without cleaning resources!\n";
    }

private:
    std::vector<Texture*> m_textures;
    std::vector<Mesh*> m_meshes;
};

// Proper resource manager
class ProperResourceManager {
public:
    ProperResourceManager() {
        ZoneScoped;
    }

    std::unique_ptr<Texture> LoadTexture(int width, int height, const std::string& name) {
        ZoneScoped;
        return std::make_unique<Texture>(width, height, name);
    }

    std::unique_ptr<Mesh> LoadMesh(size_t vertexCount, const std::string& name) {
        ZoneScoped;
        return std::make_unique<Mesh>(vertexCount, name);
    }

private:
};

// Demonstrate temporary allocations
void TemporaryAllocations() {
    ZoneScopedN("TemporaryAllocations");

    std::cout << "\n=== Temporary Allocations ===\n";

    for (int i = 0; i < 100; i++) {
        // These will be freed automatically
        std::vector<char> buffer(1024);
        std::fill(buffer.begin(), buffer.end(), 0xAA);

        // Simulate some work
        volatile int sum = 0;
        for (size_t j = 0; j < buffer.size(); j++) {
            sum += buffer[j];
        }
    }

    std::cout << "Completed 100 temporary allocations\n";
}

// Demonstrate intentional leaks
void IntentionalLeaks() {
    ZoneScopedN("IntentionalLeaks");

    std::cout << "\n=== Intentional Leaks ===\n";

    ResourceManager* rm = new ResourceManager();

    // Load resources that will leak when ResourceManager is destroyed
    rm->LoadTexture(512, 512, "leaked_texture_1");  // ~1MB
    rm->LoadTexture(1024, 1024, "leaked_texture_2"); // ~4MB
    rm->LoadTexture(2048, 2048, "leaked_texture_3"); // ~16MB

    rm->LoadMesh(10000, "leaked_mesh_1");  // ~120KB
    rm->LoadMesh(50000, "leaked_mesh_2");  // ~600KB

    delete rm; // Textures and meshes leak!

    // Also leak some raw allocations
    char* leak1 = new char[10 * 1024 * 1024];  // 10MB
    char* leak2 = new char[5 * 1024 * 1024];   // 5MB

    std::cout << "Created intentional leaks (~36 MB total)\n";
    std::cout << "  - 3 textures (~21 MB)\n";
    std::cout << "  - 2 meshes (~720 KB)\n";
    std::cout << "  - 2 raw allocations (15 MB)\n";
}

// Demonstrate proper memory management
void ProperMemoryManagement() {
    ZoneScopedN("ProperMemoryManagement");

    std::cout << "\n=== Proper Memory Management ===\n";

    ProperResourceManager rm;

    {
        auto tex1 = rm.LoadTexture(256, 256, "temp_texture_1");
        auto tex2 = rm.LoadTexture(512, 512, "temp_texture_2");
        auto mesh1 = rm.LoadMesh(1000, "temp_mesh_1");

        // Resources will be freed when going out of scope
    }

    std::cout << "All temporary resources properly freed\n";
}

// Demonstrate smart pointer usage
void SmartPointerDemo() {
    ZoneScopedN("SmartPointerDemo");

    std::cout << "\n=== Smart Pointer Demo ===\n";

    // Shared pointers with reference counting
    auto shared1 = std::make_shared<Texture>(128, 128, "shared_texture");
    auto shared2 = shared1; // Both point to same texture

    std::vector<std::shared_ptr<Texture>> textures;
    textures.push_back(std::make_shared<Texture>(64, 64, "vector_texture_1"));
    textures.push_back(std::make_shared<Texture>(64, 64, "vector_texture_2"));
    textures.push_back(std::make_shared<Texture>(64, 64, "vector_texture_3"));

    // Unique pointers
    auto unique1 = std::make_unique<Mesh>(500, "unique_mesh");

    std::cout << "Smart pointers will automatically clean up\n";
}

// Demonstrate container allocations
void ContainerAllocations() {
    ZoneScopedN("ContainerAllocations");

    std::cout << "\n=== Container Allocations ===\n";

    std::vector<int> largeVector;
    largeVector.reserve(100000);
    for (int i = 0; i < 100000; i++) {
        largeVector.push_back(i);
    }

    std::map<std::string, int> stringMap;
    for (int i = 0; i < 1000; i++) {
        stringMap["key_" + std::to_string(i)] = i;
    }

    std::cout << "Created large containers\n";
}

int main() {
    ZoneScopedN("main");

    std::cout << "========================================\n";
    std::cout << "TracyMemPro Demo\n";
    std::cout << "========================================\n";
    std::cout << "\nThis demo demonstrates memory leak detection\n";
    std::cout << "using Tracy Profiler with MemPro-style instrumentation.\n";
    std::cout << "\nMake sure Tracy Profiler is running to capture the trace!\n";

    // Simulate application initialization
    {
        ZoneScopedN("Initialization");
        std::cout << "\nInitializing...\n";
    }

    // Run various scenarios
    TemporaryAllocations();
    ProperMemoryManagement();
    SmartPointerDemo();
    ContainerAllocations();

    // Create intentional leaks at the end
    IntentionalLeaks();

    std::cout << "\n========================================\n";
    std::cout << "Demo Complete\n";
    std::cout << "========================================\n";
    std::cout << "\nNext steps:\n";
    std::cout << "1. Save the trace in Tracy Profiler\n";
    std::cout << "2. Run: find_memory_leaks(path=\"your_trace.tracy\")\n";
    std::cout << "3. Check the Memory view in Tracy Profiler\n";

    return 0;
}
