import AppKit

final class ImageView: NSView {
    private var width  = 512
    private var height = 512
    private var pixels: [UInt8] = []   // RGBA
    private var pass = 0
    private var cgImage: CGImage?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func start() {
        let z = "image_generate".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 20) }
        }
        defer { tracy_zone_end(z) }

        pixels = [UInt8](repeating: 0, count: width * height * 4)
        for y in 0 ..< height {
            for x in 0 ..< width {
                let i = (y * width + x) * 4
                pixels[i]   = UInt8((x * 255) / width)
                pixels[i+1] = UInt8((y * 255) / height)
                pixels[i+2] = UInt8(((x + y) * 128) / (width + height))
                pixels[i+3] = 255
            }
        }
        "Starting image processing scene".withCString { tracy_message_l(2, 0, $0) }
    }

    func update() {
        pass += 1
        switch pass % 3 {
        case 0: applyBoxBlur(radius: 3)
        case 1: applySharpen()
        default: applyEdgeDetect()
        }
        rebuildCGImage()
        needsDisplay = true
    }

    private func applyBoxBlur(radius: Int) {
        let z = "image_box_blur".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 47) }
        }
        defer { tracy_zone_end(z) }

        var out = pixels
        for y in radius ..< height - radius {
            for x in radius ..< width - radius {
                var r = 0, g = 0, b = 0, count = 0
                for dy in -radius ... radius {
                    for dx in -radius ... radius {
                        let i = ((y + dy) * width + (x + dx)) * 4
                        r += Int(pixels[i]); g += Int(pixels[i+1]); b += Int(pixels[i+2])
                        count += 1
                    }
                }
                let i = (y * width + x) * 4
                out[i] = UInt8(r / count); out[i+1] = UInt8(g / count); out[i+2] = UInt8(b / count)
            }
        }
        pixels = out
    }

    private func applySharpen() {
        let z = "image_sharpen".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 66) }
        }
        defer { tracy_zone_end(z) }

        // 3×3 sharpen kernel: [0,-1,0,-1,5,-1,0,-1,0]
        var out = pixels
        for y in 1 ..< height - 1 {
            for x in 1 ..< width - 1 {
                let center = (y * width + x) * 4
                let top    = ((y-1)*width+x)*4, bot = ((y+1)*width+x)*4
                let lft    = (y*width+(x-1))*4, rgt = (y*width+(x+1))*4
                for c in 0 ..< 3 {
                    let v = 5*Int(pixels[center+c]) - Int(pixels[top+c])
                          - Int(pixels[bot+c]) - Int(pixels[lft+c]) - Int(pixels[rgt+c])
                    out[center+c] = UInt8(max(0, min(255, v)))
                }
            }
        }
        pixels = out
    }

    private func applyEdgeDetect() {
        let z = "image_edge_detect".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 84) }
        }
        defer { tracy_zone_end(z) }

        // Sobel operator
        var out = [UInt8](repeating: 255, count: pixels.count)
        for y in 1 ..< height-1 {
            for x in 1 ..< width-1 {
                for c in 0 ..< 3 {
                    let p = { (dy: Int, dx: Int) -> Int in Int(self.pixels[((y+dy)*self.width+(x+dx))*4+c]) }
                    let gx = -p(-1,-1) + p(-1,1) - 2*p(0,-1) + 2*p(0,1) - p(1,-1) + p(1,1)
                    let gy = -p(-1,-1) - 2*p(-1,0) - p(-1,1) + p(1,-1) + 2*p(1,0) + p(1,1)
                    out[(y*width+x)*4+c] = UInt8(min(255, Int(sqrt(Double(gx*gx + gy*gy)))))
                }
                out[(y*width+x)*4+3] = 255
            }
        }
        pixels = out
    }

    private func rebuildCGImage() {
        let z = "image_to_cg".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 110) }
        }
        defer { tracy_zone_end(z) }

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let provider = CGDataProvider(data: NSData(bytes: pixels, length: pixels.count)) else { return }
        cgImage = CGImage(width: width, height: height,
                          bitsPerComponent: 8, bitsPerPixel: 32,
                          bytesPerRow: width * 4,
                          space: colorSpace,
                          bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                          provider: provider, decode: nil,
                          shouldInterpolate: false, intent: .defaultIntent)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext, let img = cgImage else { return }
        ctx.draw(img, in: bounds)
    }
}
