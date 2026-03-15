/**
 * Copyright (c) 2026 Bivex
 *
 * Author: Bivex
 * Available for contact via email: support@b-b.top
 * For up-to-date contact information:
 * https://github.com/bivex
 *
 * Created: 2026-03-15 04:35
 * Last Updated: 2026-03-15 04:35
 *
 * Licensed under the MIT License.
 * Commercial licensing available upon request.
 */

/**
 * Tracy MCP Benchmark Demo
 *
 * A realistic game-engine frame loop with:
 *   - CPU zones: physics (variable), render (steady), audio (occasional spike)
 *   - Frame marks (60 frames → FPS stats)
 *   - Thread names: MainThread + AssetLoader
 *   - Lock contention: audio thread races main mutex
 *   - Memory: per-frame scratch (healthy) + texture cache leak
 *   - Tracy messages at key events
 *
 * Compile and run via:  make bench  (from demo/ directory)
 */

#include <tracy/Tracy.hpp>

#include <atomic>
#include <chrono>
#include <cstring>
#include <cstdio>
#include <mutex>
#include <random>
#include <thread>
#include <vector>

// ── busy-wait helpers ─────────────────────────────────────────────────────────

static void spin_us(long us) {
    auto end = std::chrono::steady_clock::now() + std::chrono::microseconds(us);
    while (std::chrono::steady_clock::now() < end) {}
}

static void spin_us_jitter(long base_us, long jitter_us, std::mt19937& rng) {
    long t = base_us + (long)(rng() % (unsigned long)(jitter_us * 2)) - jitter_us;
    if (t < 1) t = 1;
    spin_us(t);
}

// ── shared state ──────────────────────────────────────────────────────────────

static std::mutex  g_scene_lock;
static std::vector<void*> g_leaked_textures;   // intentional leak

// ── subsystems ────────────────────────────────────────────────────────────────

static void physics_update(std::mt19937& rng) {
    ZoneScopedN("physics_update");

    // Broad-phase: fast, steady
    {
        ZoneScopedN("broad_phase");
        spin_us(800);
    }

    // Narrow-phase: variable — depends on contact count
    {
        ZoneScopedN("narrow_phase");
        spin_us_jitter(2000, 1800, rng);   // 200µs – 3800µs
    }

    // Constraint solver: occasional expensive frame
    {
        ZoneScopedN("solve_constraints");
        bool heavy = (rng() % 8 == 0);    // ~12% of frames are heavy
        spin_us(heavy ? 6000 : 400);
    }
}

static void cull_scene() {
    ZoneScopedN("cull_scene");
    spin_us(1200);   // steady ~1.2ms
}

static void render_scene(std::mt19937& rng) {
    ZoneScopedN("render_scene");

    {
        ZoneScopedN("shadow_pass");
        spin_us(2500);
    }
    {
        ZoneScopedN("geometry_pass");
        spin_us_jitter(3500, 500, rng);
    }
    {
        ZoneScopedN("lighting_pass");
        spin_us(1800);
    }
    {
        ZoneScopedN("post_process");
        spin_us(900);
    }
}

static void audio_mix(std::mt19937& rng) {
    ZoneScopedN("audio_mix");

    // Must acquire scene lock to read listener position
    {
        ZoneScopedN("wait_scene_lock");
        std::lock_guard<std::mutex> lk(g_scene_lock);
        spin_us(80);
    }

    // Mix: normally fast, spike when resampling kicks in
    bool resample = (rng() % 12 == 0);
    spin_us(resample ? 3200 : 350);
}

static void present(std::mt19937& rng) {
    ZoneScopedN("present");
    spin_us_jitter(600, 200, rng);
}

// ── asset loader thread ───────────────────────────────────────────────────────

static void asset_loader(std::atomic<bool>& done) {
    tracy::SetThreadName("AssetLoader");

    struct Asset { const char* name; size_t bytes; bool leak; };
    Asset assets[] = {
        { "terrain_diffuse.dds",  4 * 1024 * 1024, false },
        { "terrain_normal.dds",   4 * 1024 * 1024, false },
        { "skybox_hdr.dds",       8 * 1024 * 1024, true  },  // BUG: never freed
        { "character_albedo.dds", 2 * 1024 * 1024, true  },  // BUG: never freed
    };

    for (auto& a : assets) {
        ZoneScopedN("load_asset");

        // Decompress + upload
        void* p = ::operator new(a.bytes);
        TracyAlloc(p, a.bytes);
        memset(p, 0xCD, a.bytes);
        spin_us(15000);   // ~15ms decode time

        if (a.leak) {
            // Cache pointer — "forgot" to register a destructor
            g_leaked_textures.push_back(p);
            TracyMessage(a.name, strlen(a.name));
            TracyMessageL("WARNING: texture loaded into cache, no eviction path!");
        } else {
            TracyFree(p);
            ::operator delete(p);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }

    done = true;
}

// ── main ──────────────────────────────────────────────────────────────────────

int main() {
    tracy::SetThreadName("MainThread");

    TracyMessageL("=== bench.cpp starting ===");

    std::mt19937 rng(12345);
    std::atomic<bool> loader_done{false};
    std::thread loader_thread(asset_loader, std::ref(loader_done));

    const int FRAMES = 120;
    TracyMessageL("Starting 120-frame loop");

    for (int f = 0; f < FRAMES; f++) {
        ZoneScopedN("frame");

        // Main thread briefly holds scene lock (creates contention with audio)
        {
            ZoneScopedN("update_scene");
            std::lock_guard<std::mutex> lk(g_scene_lock);
            spin_us(200);
        }

        physics_update(rng);
        cull_scene();
        render_scene(rng);
        audio_mix(rng);
        present(rng);

        // Per-frame scratch buffer: alloc + use + free (healthy pattern)
        void* scratch = ::operator new(128 * 1024);
        TracyAlloc(scratch, 128 * 1024);
        memset(scratch, 0, 128 * 1024);
        TracyFree(scratch);
        ::operator delete(scratch);

        if (f % 30 == 0) {
            char msg[64];
            snprintf(msg, sizeof(msg), "Frame %d / %d", f, FRAMES);
            TracyMessage(msg, strlen(msg));
        }

        FrameMark;
    }

    TracyMessageL("Frame loop complete — joining loader");
    loader_thread.join();

    // Intentionally NOT freeing g_leaked_textures — leak demo
    TracyMessageL("Shutdown. Leaked textures remain in memory.");

    printf("bench: done. %zu textures leaked (%.0f MB)\n",
           g_leaked_textures.size(),
           (double)(10 * 1024 * 1024) / 1024.0 / 1024.0);

    return 0;
}
