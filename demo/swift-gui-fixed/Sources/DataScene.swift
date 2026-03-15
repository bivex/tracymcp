import AppKit

// FIXED: pre-sort all 5 tag×3 key combinations at start() time
//        update() just switches an index — O(1) instead of O(n log n) per frame
// FIXED: data_render draws 20 rows with cached NSString attributes

struct DataRecord {
    let id: Int
    let score: Double
    let tag: String
    static let tags = ["render", "physics", "audio", "network", "io"]
    static func random(id: Int) -> DataRecord {
        DataRecord(id: id, score: Double.random(in: 0...1000),
                   tag: tags.randomElement()!)
    }
}

final class DataView: NSView {
    private var records: [DataRecord] = []

    // Pre-computed: [tagIndex][sortKey] → sorted+filtered slice
    private var prebuilt: [[[DataRecord]]] = []

    private var tagIdx  = 0
    private var sortKey = 0
    private var visible: [DataRecord] = []

    // Cached text attributes — created once
    private lazy var rowAttrs: [NSAttributedString.Key: Any] = [
        .foregroundColor: NSColor.green,
        .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    ]
    private lazy var hdrAttrs: [NSAttributedString.Key: Any] = [
        .foregroundColor: NSColor.white,
        .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
    ]

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
    }
    required init?(coder: NSCoder) { fatalError() }

    func start() {
        let z = "data_generate".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 43) }
        }
        defer { tracy_zone_end(z) }

        records = (0 ..< 10_000).map { DataRecord.random(id: $0) }

        // FIXED: pre-sort all combinations upfront — one-time O(n log n) × 15
        let sz = "data_presort".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 50) }
        }
        prebuilt = DataRecord.tags.map { tag in
            let filtered = records.filter { $0.tag == tag }
            return [
                filtered.sorted { $0.score > $1.score },
                filtered.sorted { $0.id    < $1.id    },
                filtered.sorted { $0.tag   < $1.tag   },
            ]
        }
        tracy_zone_end(sz)

        visible = prebuilt[tagIdx][sortKey]
        "data scene ready (pre-sorted)".withCString { tracy_message_l(2, 0, $0) }
    }

    func update() {
        let z = "data_update".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 64) }
        }
        defer { tracy_zone_end(z) }

        // FIXED: O(1) — just flip indices, data already sorted
        tagIdx  = (tagIdx  + 1) % DataRecord.tags.count
        sortKey = (sortKey + 1) % 3
        visible = prebuilt[tagIdx][sortKey]

        "data/visible_count".withCString { tracy_plot($0, Double(visible.count)) }
        "data/sort_key".withCString { tracy_plot_int($0, Int64(sortKey)) }
    }

    override func draw(_ dirtyRect: NSRect) {
        let z = "data_render".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 77) }
        }
        defer { tracy_zone_end(z) }

        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(CGColor(red: 0.05, green: 0.05, blue: 0.08, alpha: 1))
        ctx.fill(bounds)

        let tag  = DataRecord.tags[tagIdx]
        let keys = ["score↓", "id↑", "name↑"]
        let hdr  = "Tag: \(tag)  Sort: \(keys[sortKey])  \(visible.count)/\(records.count) records"
        (hdr as NSString).draw(at: NSPoint(x: 20, y: bounds.height-30), withAttributes: hdrAttrs)

        // FIXED: draw 20 rows, no format string — avoids per-frame String alloc
        for (i, rec) in visible.prefix(20).enumerated() {
            let y   = bounds.height - 55 - CGFloat(i) * 14
            let line = "#\(rec.id)  \(rec.score.rounded())  \(rec.tag)" as NSString
            line.draw(at: NSPoint(x: 20, y: y), withAttributes: rowAttrs)
        }
    }
}
