import AppKit

struct DataRecord {
    let id: Int
    let name: String
    let score: Double
    let tag: String

    static let tags = ["render", "physics", "audio", "network", "io"]

    static func random(id: Int) -> DataRecord {
        DataRecord(
            id: id,
            name: "entity_\(id)",
            score: Double.random(in: 0 ... 1000),
            tag: tags.randomElement()!)
    }
}

final class DataView: NSView {
    private var records: [DataRecord] = []
    private var visible: [DataRecord] = []
    private var sortKey = 0   // 0=score, 1=id, 2=name
    private var filterTag = 0

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
    }
    required init?(coder: NSCoder) { fatalError() }

    func start() {
        let z = "data_generate".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 36) }
        }
        defer { tracy_zone_end(z) }

        records = (0 ..< 10_000).map { DataRecord.random(id: $0) }
        "data_generate".withCString { tracy_message_l(2, 0, $0) }
        applyFilter()
    }

    func update() {
        sortKey = (sortKey + 1) % 3
        filterTag = (filterTag + 1) % DataRecord.tags.count
        applyFilter()
        needsDisplay = true
    }

    private func applyFilter() {
        let tag = DataRecord.tags[filterTag]

        let fz = "data_filter".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 52) }
        }
        let filtered = records.filter { $0.tag == tag }
        tracy_zone_end(fz)

        let sz = "data_sort".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 58) }
        }
        switch sortKey {
        case 0: visible = filtered.sorted { $0.score > $1.score }
        case 1: visible = filtered.sorted { $0.id < $1.id }
        default: visible = filtered.sorted { $0.name < $1.name }
        }
        tracy_zone_end(sz)

        "data/visible_count".withCString { tracy_plot($0, Double(visible.count)) }
        "data/sort_key".withCString { tracy_plot_int($0, Int64(sortKey)) }
    }

    override func draw(_ dirtyRect: NSRect) {
        let z = "data_render".withCString { n in
            "DataScene.swift".withCString { f in tracy_zone_begin(n, f, 74) }
        }
        defer { tracy_zone_end(z) }

        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(CGColor(red: 0.05, green: 0.05, blue: 0.08, alpha: 1))
        ctx.fill(bounds)

        let attrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.green,
            .font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        ]
        let headerAttrs: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.white,
            .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        ]

        let tag = DataRecord.tags[filterTag]
        let keys = ["score\u{2193}", "id\u{2191}", "name\u{2191}"]
        let header = "Tag: \(tag)  Sort: \(keys[sortKey])  Showing \(visible.count) / \(records.count)"
        (header as NSString).draw(at: NSPoint(x: 20, y: bounds.height - 30), withAttributes: headerAttrs)

        for (i, rec) in visible.prefix(40).enumerated() {
            let y = bounds.height - 60 - CGFloat(i) * 13
            let line = String(format: "#%-5d  %-20@  %7.2f  %@",
                              rec.id, rec.name as NSString, rec.score, rec.tag as NSString)
            (line as NSString).draw(at: NSPoint(x: 20, y: y), withAttributes: attrs)
        }
    }
}
