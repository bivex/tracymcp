import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var timer: Timer?
    var tick = 0

    // Child scenes (set contentView each time scene switches)
    var particleScene: ParticleView!
    var imageScene: ImageView!
    var dataScene: DataView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        "MainThread".withCString { tracy_set_thread_name($0) }
        "GUI Demo started — 3 scenes × 3s each".withCString { tracy_message_l(2, 0, $0) }

        window = NSWindow(
            contentRect: NSRect(x: 100, y: 100, width: 800, height: 600),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered, defer: false)
        window.title = "Tracy Swift GUI Demo"
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        particleScene = ParticleView(frame: window.contentView!.bounds)
        imageScene    = ImageView(frame: window.contentView!.bounds)
        dataScene     = DataView(frame: window.contentView!.bounds)

        window.contentView = particleScene   // start with particles

        timer = Timer.scheduledTimer(withTimeInterval: 1.0/60.0, repeats: true) { [weak self] _ in
            self?.gameTick()
        }
        // Auto-quit after 9 seconds so `make run` is non-interactive
        DispatchQueue.main.asyncAfter(deadline: .now() + 9.5) {
            "Demo complete — quitting".withCString { tracy_message_l(2, 0, $0) }
            NSApp.terminate(nil)
        }
    }

    func gameTick() {
        let z = "frame".withCString { tracy_zone_begin($0, "AppDelegate.swift", 62) }
        defer { tracy_zone_end(z) }

        tick += 1
        let second = tick / 60

        switch second {
        case 0..<3:
            if window.contentView !== particleScene { window.contentView = particleScene }
            particleScene.update()
            particleScene.needsDisplay = true
        case 3..<6:
            if window.contentView !== imageScene { window.contentView = imageScene; imageScene.start() }
            imageScene.update()
            imageScene.needsDisplay = true
        default:
            if window.contentView !== dataScene { window.contentView = dataScene; dataScene.start() }
            dataScene.update()
            dataScene.needsDisplay = true
        }

        tracy_frame_mark()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
