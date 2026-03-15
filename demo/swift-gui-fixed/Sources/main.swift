import AppKit
import Foundation

// Bootstrap NSApplication without a storyboard
let app = NSApplication.shared
app.setActivationPolicy(.regular)

let delegate = AppDelegate()
app.delegate = delegate

app.run()
