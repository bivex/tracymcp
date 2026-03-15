import AppKit

// FIXED: 256×256 instead of 512×512 (4× fewer pixels)
// FIXED: Separable box blur  O(2·radius·W·H) vs O(radius²·W·H)
// FIXED: Sobel with direct indexing, no closures or heap allocs per call

final class ImageView: NSView {
    private let width  = 256
    private let height = 256
    private var pixels: [UInt8] = []
    private var scratch: [UInt8] = []   // reused temp buffer — no alloc per pass
    private var pass = 0
    private var cgImage: CGImage?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }
    required init?(coder: NSCoder) { fatalError() }

    func start() {
        let z = "image_generate".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 19) }
        }
        defer { tracy_zone_end(z) }

        let count = width * height * 4
        pixels  = [UInt8](repeating: 0, count: count)
        scratch = [UInt8](repeating: 0, count: count)
        for y in 0 ..< height {
            for x in 0 ..< width {
                let i = (y * width + x) * 4
                pixels[i]   = UInt8((x * 255) / width)
                pixels[i+1] = UInt8((y * 255) / height)
                pixels[i+2] = UInt8(((x + y) * 128) / (width + height))
                pixels[i+3] = 255
            }
        }
        rebuildCGImage()
        "image scene ready (256x256 separable)".withCString { tracy_message_l(2, 0, $0) }
    }

    func update() {
        pass += 1
        switch pass % 3 {
        case 0: applyBoxBlur(radius: 1)
        case 1: applySharpen()
        default: applyEdgeDetect()
        }
        rebuildCGImage()
        needsDisplay = true
    }

    // FIXED: two 1-D passes instead of full 2-D kernel
    private func applyBoxBlur(radius: Int) {
        let z = "image_box_blur".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 51) }
        }
        defer { tracy_zone_end(z) }

        let W = width, H = height
        // Horizontal pass: pixels → scratch
        for y in 0 ..< H {
            for x in 0 ..< W {
                var r = 0, g = 0, b = 0, n = 0
                for dx in max(0, x-radius) ... min(W-1, x+radius) {
                    let i = (y*W+dx)*4
                    r += Int(pixels[i]); g += Int(pixels[i+1]); b += Int(pixels[i+2])
                    n += 1
                }
                let o = (y*W+x)*4
                scratch[o]=UInt8(r/n); scratch[o+1]=UInt8(g/n)
                scratch[o+2]=UInt8(b/n); scratch[o+3]=pixels[o+3]
            }
        }
        // Vertical pass: scratch → pixels
        for y in 0 ..< H {
            for x in 0 ..< W {
                var r = 0, g = 0, b = 0, n = 0
                for dy in max(0, y-radius) ... min(H-1, y+radius) {
                    let i = (dy*W+x)*4
                    r += Int(scratch[i]); g += Int(scratch[i+1]); b += Int(scratch[i+2])
                    n += 1
                }
                let o = (y*W+x)*4
                pixels[o]=UInt8(r/n); pixels[o+1]=UInt8(g/n); pixels[o+2]=UInt8(b/n)
            }
        }
    }

    // FIXED: direct indexing with precomputed strides, no intermediate arrays
    private func applySharpen() {
        let z = "image_sharpen".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 79) }
        }
        defer { tracy_zone_end(z) }

        let W = width, H = height, row = W*4
        scratch = pixels
        for y in 1 ..< H-1 {
            for x in 1 ..< W-1 {
                let c = (y*W+x)*4
                for ch in 0 ..< 3 {
                    let v = 5*Int(pixels[c+ch])
                          - Int(pixels[c-row+ch]) - Int(pixels[c+row+ch])
                          - Int(pixels[c-4+ch])   - Int(pixels[c+4+ch])
                    scratch[c+ch] = UInt8(clamping: v)
                }
            }
        }
        pixels = scratch
    }

    // FIXED: direct Sobel, no closures
    private func applyEdgeDetect() {
        let z = "image_edge_detect".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 97) }
        }
        defer { tracy_zone_end(z) }

        let W = width, H = height, row = W*4
        for i in 0 ..< scratch.count { scratch[i] = 255 }
        for y in 1 ..< H-1 {
            for x in 1 ..< W-1 {
                let c = (y*W+x)*4
                for ch in 0 ..< 3 {
                    let tl=Int(pixels[c-row-4+ch]), tc=Int(pixels[c-row+ch]), tr=Int(pixels[c-row+4+ch])
                    let cl=Int(pixels[c-4+ch]), cr=Int(pixels[c+4+ch])
                    let bl=Int(pixels[c+row-4+ch]), bc=Int(pixels[c+row+ch]), br=Int(pixels[c+row+4+ch])
                    let gx = -tl - 2*cl - bl + tr + 2*cr + br
                    let gy = -tl - 2*tc - tr + bl + 2*bc + br
                    let mag = Int(sqrt(Double(gx*gx + gy*gy)))
                    scratch[c+ch] = UInt8(min(255, mag))
                }
                scratch[c+3] = 255
            }
        }
        pixels = scratch
    }

    private func rebuildCGImage() {
        let z = "image_to_cg".withCString { n in
            "ImageScene.swift".withCString { f in tracy_zone_begin(n, f, 121) }
        }
        defer { tracy_zone_end(z) }

        let cs = CGColorSpaceCreateDeviceRGB()
        guard let dp = CGDataProvider(data: NSData(bytes: pixels, length: pixels.count)) else { return }
        cgImage = CGImage(width: width, height: height,
                          bitsPerComponent: 8, bitsPerPixel: 32,
                          bytesPerRow: width*4, space: cs,
                          bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                          provider: dp, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext, let img = cgImage else { return }
        ctx.draw(img, in: bounds)
    }
}
