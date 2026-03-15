/**
 * Tracy Swift Demo — game-engine frame loop simulation
 *
 * Demonstrates all MCP-visible Tracy features from Swift:
 *   • CPU zones with source locations (physics, render, audio sub-zones)
 *   • Thread names  (MainThread + AssetLoader)
 *   • Memory tracking — per-frame scratch (healthy) + texture leak (bug)
 *   • Frame marks   → get_frame_stats shows FPS / dropped frames
 *   • Plot streams  → get_plot_stats shows FPS + physics contact count
 *   • Messages      → list_messages shows startup, checkpoints, leak warnings
 *
 * Build:   make   (from this directory — starts capture automatically)
 * Analyse: pass swift_demo.tracy to any tracymcp MCP tool
 */

import Foundation

// ── Tracy helpers (wraps the C bridge) ───────────────────────────────────────

enum Severity: Int8 {
    case trace   = 0
    case debug   = 1
    case info    = 2
    case warning = 3
    case error   = 4
    case fatal   = 5
}

/// RAII zone — ends automatically when it goes out of scope.
final class Zone {
    private var z: TZone

    init(_ name: String, color: UInt32? = nil,
         file: String = #fileID, line: UInt32 = UInt32(#line)) {
        z = name.withCString { n in
            file.withCString { f in tracy_zone_begin(n, f, line) }
        }
        if let c = color { tracy_zone_color(z, c) }
    }

    func text(_ s: String) {
        s.withCString { tracy_zone_text(z, $0, s.utf8.count) }
    }

    deinit { tracy_zone_end(z) }
}

/// Functional zone — result-transparent, source-location captured at call site.
@discardableResult
@inline(__always)
func zone<T>(_ name: String, color: UInt32? = nil,
             file: String = #fileID, line: UInt32 = UInt32(#line),
             _ body: () throws -> T) rethrows -> T {
    let z = Zone(name, color: color, file: file, line: line)
    let r = try body()
    _ = z   // keep alive until body returns
    return r
}

func msg(_ text: String, severity: Severity = .info, color: Int32 = 0) {
    text.withCString { tracy_message(severity.rawValue, color, $0, text.utf8.count) }
}

func plot(_ name: String, _ value: Double) {
    name.withCString { tracy_plot($0, value) }
}

func threadName(_ name: String) {
    name.withCString { tracy_set_thread_name($0) }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func spinUs(_ us: Int) {
    let end = Date().addingTimeInterval(Double(us) / 1_000_000)
    while Date() < end {}
}

var globalRng = SystemRandomNumberGenerator()

func rand(_ range: ClosedRange<Int>) -> Int {
    Int.random(in: range, using: &globalRng)
}

// ── Subsystems ────────────────────────────────────────────────────────────────

func physicsUpdate() {
    zone("physics_update", color: 0x00DDFF) {
        // Broad phase: steady
        zone("broad_phase") { spinUs(800) }

        // Narrow phase: scales with contact count (high variance)
        let contacts = rand(20...280)
        zone("narrow_phase") {
            spinUs(contacts * 9)
        }
        plot("physics/contacts", Double(contacts))

        // Constraint solver: occasional expensive frame (~12%)
        let heavy = rand(0...7) == 0
        zone("solve_constraints") {
            spinUs(heavy ? 5800 : 380)
        }
        if heavy { msg("⚡ constraint solver spike", severity: .debug) }
    }
}

func renderFrame() {
    zone("render_frame", color: 0x8800FF) {
        zone("shadow_pass")   { spinUs(2500) }
        zone("geometry_pass") { spinUs(rand(2900...3900)) }
        zone("lighting_pass") { spinUs(1800) }
        zone("post_process")  { spinUs(rand(700...1100)) }
    }
}

func audioMix() {
    zone("audio_mix", color: 0xFF8800) {
        // Occasional resampling spike (~8% of frames)
        let resample = rand(0...11) == 0
        spinUs(resample ? 3100 : 330)
        if resample { msg("🎵 audio resampler activated", severity: .debug, color: 0xFF8800) }
        plot("audio/latency_us", Double(resample ? 3100 : 330))
    }
}

// ── Asset loader (background thread) ─────────────────────────────────────────

struct TextureAsset {
    let name: String
    let sizeBytes: Int
    let leak: Bool           // true = simulated bug: no eviction path
}

let textures: [TextureAsset] = [
    TextureAsset(name: "terrain_diffuse.dds", sizeBytes: 4 * 1024 * 1024, leak: false),
    TextureAsset(name: "terrain_normal.dds",  sizeBytes: 4 * 1024 * 1024, leak: false),
    TextureAsset(name: "skybox_hdr.dds",      sizeBytes: 8 * 1024 * 1024, leak: true),  // BUG
    TextureAsset(name: "character_skin.dds",  sizeBytes: 2 * 1024 * 1024, leak: true),  // BUG
]

// Leaked pointers (intentionally not freed)
var leakedPtrs: [UnsafeMutableRawPointer] = []
let leakLock = NSLock()

func assetLoaderThread(done: DispatchSemaphore) {
    threadName("AssetLoader")

    for tex in textures {
        zone("load_texture") {
            let ptr = UnsafeMutableRawPointer.allocate(
                byteCount: tex.sizeBytes, alignment: 16)
            memset(ptr, 0xCD, tex.sizeBytes)    // simulate decode
            tex.name.withCString { tracy_mem_alloc_n(ptr, tex.sizeBytes, $0) }

            spinUs(12_000)  // ~12ms decode time per texture

            if tex.leak {
                msg("⚠️ \(tex.name) cached — no eviction path", severity: .warning, color: 0xFF6600)
                leakLock.lock()
                leakedPtrs.append(ptr)
                leakLock.unlock()
                // ptr intentionally NOT freed — this is the bug
            } else {
                tex.name.withCString { tracy_mem_free_n(ptr, $0) }
                ptr.deallocate()
            }
        }
        Thread.sleep(forTimeInterval: 0.018)
    }

    done.signal()
}

// ── Main game loop ────────────────────────────────────────────────────────────

func runGameLoop(frames: Int) {
    let loaderDone = DispatchSemaphore(value: 0)
    let loader = Thread { assetLoaderThread(done: loaderDone) }
    loader.start()

    msg("Starting \(frames)-frame loop", severity: .info)

    for frame in 0..<frames {
        let frameStart = Date()

        zone("frame") {
            // Per-frame scratch buffer — healthy pattern (alloc + use + free)
            let scratch = UnsafeMutableRawPointer.allocate(byteCount: 128 * 1024, alignment: 16)
            tracy_mem_alloc(scratch, 128 * 1024)
            memset(scratch, 0, 128 * 1024)

            physicsUpdate()
            renderFrame()
            audioMix()

            tracy_mem_free(scratch)
            scratch.deallocate()
        }

        let frameMs = Date().timeIntervalSince(frameStart) * 1000
        let fps = frameMs > 0 ? 1000.0 / frameMs : 0
        plot("FPS", fps)
        plot("frame_ms", frameMs)

        if frame % 30 == 0 {
            msg("Frame \(frame)/\(frames) — \(String(format: "%.1f", fps)) FPS",
                severity: .info)
        }

        tracy_frame_mark()
    }

    loaderDone.wait()

    let leakedMB = leakedPtrs.reduce(0) { _, _ in 10 }  // 8+2 MB
    msg("Shutdown — \(leakedPtrs.count) textures leaked (~10 MB total)",
        severity: .warning, color: 0xFF4400)
}

// ── Entry point ───────────────────────────────────────────────────────────────

threadName("MainThread")
msg("=== Tracy Swift Demo starting ===", severity: .info)

let frames = CommandLine.arguments.count > 1
    ? Int(CommandLine.arguments[1]) ?? 120
    : 120

runGameLoop(frames: frames)

print("Done. Leaked textures: \(leakedPtrs.count) (~10 MB)")
print("Open swift_demo.tracy in Tracy or run: tracymcp find_problematic_zones swift_demo.tracy")
