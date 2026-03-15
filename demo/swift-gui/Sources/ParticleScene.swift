import AppKit

struct Particle {
    var x, y: Float
    var vx, vy: Float
    var life: Float        // 0..1, decreases per frame
    var r, g, b: Float

    static func spawn(bounds: CGRect) -> Particle {
        let cx = Float(bounds.midX), cy = Float(bounds.midY)
        let angle = Float.random(in: 0 ..< 2 * .pi)
        let speed = Float.random(in: 50 ... 200)
        return Particle(
            x: cx, y: cy,
            vx: cos(angle) * speed, vy: sin(angle) * speed,
            life: Float.random(in: 0.5 ... 1.0),
            r: Float.random(in: 0 ... 1),
            g: Float.random(in: 0 ... 1),
            b: Float.random(in: 0 ... 1))
    }
}

final class ParticleView: NSView {
    private var particles: [Particle] = []
    private let maxParticles = 500
    private let dt: Float = 1.0 / 60.0
    private let gravity: Float = -120
    private var frameCount = 0

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        // Pre-spawn
        for _ in 0 ..< maxParticles {
            particles.append(.spawn(bounds: bounds))
        }
    }
    required init?(coder: NSCoder) { fatalError() }

    func update() {
        let z = "particle_update".withCString { n in
            "ParticleScene.swift".withCString { f in tracy_zone_begin(n, f, 48) }
        }
        defer { tracy_zone_end(z) }

        frameCount += 1
        var alive = 0

        for i in 0 ..< particles.count {
            particles[i].x    += particles[i].vx * dt
            particles[i].y    += particles[i].vy * dt
            particles[i].vy   += gravity * dt
            particles[i].life -= dt * 0.3

            // Bounce off walls
            if particles[i].x < 0 { particles[i].x = 0; particles[i].vx *= -0.8 }
            if particles[i].x > Float(bounds.width)  { particles[i].x = Float(bounds.width);  particles[i].vx *= -0.8 }
            if particles[i].y < 0 { particles[i].y = 0; particles[i].vy *= -0.6 }

            if particles[i].life > 0 { alive += 1 }
        }

        // Remove dead, spawn new
        particles = particles.filter { $0.life > 0 }
        while particles.count < maxParticles {
            particles.append(.spawn(bounds: bounds))
        }

        "physics/alive".withCString { tracy_plot($0, Double(alive)) }
    }

    override func draw(_ dirtyRect: NSRect) {
        let z = "particle_render".withCString { n in
            "ParticleScene.swift".withCString { f in tracy_zone_begin(n, f, 79) }
        }
        defer { tracy_zone_end(z) }

        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(CGColor(red: 0.03, green: 0.03, blue: 0.06, alpha: 1))
        ctx.fill(bounds)

        for p in particles {
            let alpha = CGFloat(p.life)
            ctx.setFillColor(CGColor(red: CGFloat(p.r), green: CGFloat(p.g), blue: CGFloat(p.b), alpha: alpha))
            let sz: CGFloat = 3 + CGFloat(p.life) * 3
            ctx.fillEllipse(in: CGRect(x: CGFloat(p.x) - sz/2, y: CGFloat(p.y) - sz/2, width: sz, height: sz))
        }
    }
}
