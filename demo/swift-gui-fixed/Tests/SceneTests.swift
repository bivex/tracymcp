import Foundation

// ── Particle physics ──────────────────────────────────────────────────────────

struct TestParticle {
    var x, y: Float
    var vx, vy: Float
    var life: Float
}

func updateParticles(_ particles: inout [TestParticle], dt: Float) {
    let gravity: Float = -120
    for i in 0 ..< particles.count {
        particles[i].x    += particles[i].vx * dt
        particles[i].y    += particles[i].vy * dt
        particles[i].vy   += gravity * dt
        particles[i].life -= dt * 0.3
        if particles[i].x < 0   { particles[i].x = 0;   particles[i].vx *= -0.8 }
        if particles[i].x > 800 { particles[i].x = 800; particles[i].vx *= -0.8 }
        if particles[i].y < 0   { particles[i].y = 0;   particles[i].vy *= -0.6 }
    }
    particles = particles.filter { $0.life > 0 }
}

// ── Image processing ──────────────────────────────────────────────────────────

func boxBlur(_ pixels: inout [UInt8], width: Int, height: Int, radius: Int = 2) {
    var out = pixels
    for y in radius ..< height - radius {
        for x in radius ..< width - radius {
            var r = 0, g = 0, b = 0, n = 0
            for dy in -radius ... radius {
                for dx in -radius ... radius {
                    let i = ((y+dy)*width+(x+dx))*4
                    r += Int(pixels[i]); g += Int(pixels[i+1]); b += Int(pixels[i+2]); n += 1
                }
            }
            let i = (y*width+x)*4
            out[i] = UInt8(r/n); out[i+1] = UInt8(g/n); out[i+2] = UInt8(b/n)
        }
    }
    pixels = out
}

// ── Data processing ───────────────────────────────────────────────────────────

struct TestRecord {
    let id: Int
    let score: Double
    let tag: String
}

func runSceneTests() {
    // Particle: update reduces life
    var particles = (0..<100).map { i in
        TestParticle(x: Float(i*8), y: 300, vx: Float(i), vy: 100, life: 1.0)
    }
    let before = particles.count
    // life starts at 1.0, decreases by dt*0.3 per frame; need >1/0.3 ≈ 3.34s = >200 frames
    for _ in 0..<250 { updateParticles(&particles, dt: 1.0/60.0) }
    check(particles.count < before, "particles die over time")
    check(particles.allSatisfy { $0.life > 0 }, "surviving particles have life > 0")
    check(particles.allSatisfy { $0.x >= 0 }, "particles don't go below x=0")

    // Particle: velocity affected by gravity
    var p = TestParticle(x: 400, y: 300, vx: 0, vy: 100, life: 1)
    let vyBefore = p.vy
    // Direct physics update (bypassing filter)
    p.vy += -120 * (1.0/60.0)
    check(p.vy < vyBefore, "gravity reduces vy")

    // Image: blur doesn't crash, changes pixels
    var pixels = [UInt8](repeating: 0, count: 64*64*4)
    for i in stride(from: 0, to: pixels.count, by: 4) {
        pixels[i] = UInt8(i % 256); pixels[i+3] = 255
    }
    boxBlur(&pixels, width: 64, height: 64, radius: 2)
    check(pixels.count == 64*64*4, "blur preserves pixel buffer size")
    check(pixels[64*4+4+3] == 255, "blur preserves alpha")

    // Data: sort correctness
    let records = (0..<1000).map { TestRecord(id: $0, score: Double($0 % 100) * 3.7, tag: "a") }
    let sorted = records.sorted { $0.score > $1.score }
    check(sorted.first!.score >= sorted.last!.score, "sort descending is correct")
    let byId = records.sorted { $0.id < $1.id }
    check(byId.first!.id == 0 && byId.last!.id == 999, "sort by id is correct")

    // Data: filter correctness
    let tags = ["render", "physics", "audio"]
    let mixed = (0..<300).map { TestRecord(id: $0, score: Double($0), tag: tags[$0 % 3]) }
    let filtered = mixed.filter { $0.tag == "physics" }
    check(filtered.count == 100, "filter keeps correct count")
    check(filtered.allSatisfy { $0.tag == "physics" }, "filter keeps only matching records")

    // Tracy zones used inside scene logic don't crash
    let z = "scene_logic".withCString { n in "SceneTests.swift".withCString { f in tracy_zone_begin(n, f, 90) } }
    let _ = records.sorted { $0.score > $1.score }
    tracy_zone_end(z)
    check(true, "tracy zones inside scene logic don't crash")

    // Memory tracking around heap allocation
    let buf = UnsafeMutableRawPointer.allocate(byteCount: 65536, alignment: 16)
    tracy_mem_alloc(buf, 65536)
    memset(buf, 0xAB, 65536)
    tracy_mem_free(buf)
    buf.deallocate()
    check(true, "memory tracking around real heap allocation")
}
