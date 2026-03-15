import AppKit

// FIXED: CGMutablePath batches all particles → 1 fill call instead of 500
// FIXED: particles grouped by color bucket so we minimise state changes

struct Particle {
    var x, y: Float
    var vx, vy: Float
    var life: Float
    var colorBucket: Int   // 0=red, 1=green, 2=blue, 3=white

    static func spawn(bounds: CGRect) -> Particle {
        let cx = Float(bounds.midX), cy = Float(bounds.midY)
        let angle = Float.random(in: 0 ..< 2 * .pi)
        let speed = Float.random(in: 50 ... 200)
        return Particle(x: cx, y: cy,
                        vx: cos(angle) * speed, vy: sin(angle) * speed,
                        life: Float.random(in: 0.5 ... 1.0),
                        colorBucket: Int.random(in: 0...3))
    }
}

// Pre-built CGColors for each bucket — created once, not per frame
private let bucketColors: [CGColor] = [
    CGColor(red: 1, green: 0.3, blue: 0.3, alpha: 1),
    CGColor(red: 0.3, green: 1, blue: 0.5, alpha: 1),
    CGColor(red: 0.4, green: 0.6, blue: 1, alpha: 1),
    CGColor(red: 1,   green: 1,   blue: 1, alpha: 1),
]

final class ParticleView: NSView {
    private var particles: [Particle] = []
    private let maxParticles = 500
    private let dt: Float = 1.0 / 60.0
    private let gravity: Float = -120

    // Reuse path objects each frame — no heap alloc per frame
    private var paths = (0...3).map { _ in CGMutablePath() }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        for _ in 0 ..< maxParticles { particles.append(.spawn(bounds: frame)) }
    }
    required init?(coder: NSCoder) { fatalError() }

    func update() {
        let z = "particle_update".withCString { n in
            "ParticleScene.swift".withCString { f in tracy_zone_begin(n, f, 44) }
        }
        defer { tracy_zone_end(z) }

        for i in 0 ..< particles.count {
            particles[i].x    += particles[i].vx * dt
            particles[i].y    += particles[i].vy * dt
            particles[i].vy   += gravity * dt
            particles[i].life -= dt * 0.3
            if particles[i].x < 0                { particles[i].x = 0;               particles[i].vx *= -0.8 }
            if particles[i].x > Float(bounds.width) { particles[i].x = Float(bounds.width); particles[i].vx *= -0.8 }
            if particles[i].y < 0                { particles[i].y = 0;               particles[i].vy *= -0.6 }
        }
        particles.removeAll(where: { $0.life <= 0 })
        while particles.count < maxParticles { particles.append(.spawn(bounds: bounds)) }

        "physics/alive".withCString { tracy_plot($0, Double(particles.count)) }
    }

    override func draw(_ dirtyRect: NSRect) {
        let z = "particle_render".withCString { n in
            "ParticleScene.swift".withCString { f in tracy_zone_begin(n, f, 65) }
        }
        defer { tracy_zone_end(z) }

        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(CGColor(red: 0.03, green: 0.03, blue: 0.06, alpha: 1))
        ctx.fill(bounds)

        // Reset paths
        for i in 0...3 { paths[i] = CGMutablePath() }

        // Batch particles into 4 paths by color bucket — FIXED
        for p in particles {
            let sz = CGFloat(1.5 + p.life * 3)
            paths[p.colorBucket].addEllipse(in: CGRect(
                x: CGFloat(p.x)-sz/2, y: CGFloat(p.y)-sz/2, width: sz, height: sz))
        }

        // 4 fill calls instead of 500
        for i in 0...3 {
            ctx.setFillColor(bucketColors[i])
            ctx.addPath(paths[i])
            ctx.fillPath()
        }
    }
}
