import Foundation

func runBridgeTests() {
    // Zone lifecycle
    let z1 = "test_zone".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 1) } }
    tracy_zone_end(z1)
    check(true, "zone begin+end")

    // Zone color
    let z2 = "colored".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 2) } }
    tracy_zone_color(z2, 0xFF0000)
    tracy_zone_end(z2)
    check(true, "zone_color")

    // Zone text
    let z3 = "annotated".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 3) } }
    "extra info".withCString { tracy_zone_text(z3, $0, 10) }
    tracy_zone_end(z3)
    check(true, "zone_text")

    // Nested zones
    let outer = "outer".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 4) } }
    let inner = "inner".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 5) } }
    tracy_zone_end(inner)
    tracy_zone_end(outer)
    check(true, "nested zones")

    // Messages — all severities
    for sev: Int8 in [0, 1, 2, 3, 4, 5] {
        "test message".withCString { tracy_message(sev, 0, $0, 12) }
    }
    check(true, "messages all severities")

    // Message with color
    "warning!".withCString { tracy_message(3, Int32(bitPattern: 0xFFAA00), $0, 8) }
    check(true, "message_color")

    // Message literal
    "literal".withCString { tracy_message_l(2, 0, $0) }
    check(true, "message_l")

    // Frame marks
    tracy_frame_mark()
    check(true, "frame_mark")
    "named_frame".withCString { tracy_frame_mark_named($0) }
    check(true, "frame_mark_named")

    // Memory alloc/free
    let ptr = UnsafeMutableRawPointer.allocate(byteCount: 4096, alignment: 8)
    tracy_mem_alloc(ptr, 4096)
    tracy_mem_free(ptr)
    ptr.deallocate()
    check(true, "mem_alloc + mem_free")

    // Named memory
    let ptr2 = UnsafeMutableRawPointer.allocate(byteCount: 1024, alignment: 8)
    "MyBuffer".withCString { tracy_mem_alloc_n(ptr2, 1024, $0) }
    "MyBuffer".withCString { tracy_mem_free_n(ptr2, $0) }
    ptr2.deallocate()
    check(true, "mem_alloc_n + mem_free_n")

    // Plots
    "test_plot".withCString { tracy_plot($0, 3.14) }
    "test_plot_int".withCString { tracy_plot_int($0, 42) }
    check(true, "plot + plot_int")

    // Thread name
    "TestThread".withCString { tracy_set_thread_name($0) }
    check(true, "set_thread_name")

    // 1000 rapid zones (stress test)
    for i in 0 ..< 1000 {
        let z = "stress".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, UInt32(i)) } }
        tracy_zone_end(z)
    }
    check(true, "1000 rapid zones (stress)")

    // Zone handle values — Tracy assigns a nonzero id when active
    let zCheck = "check".withCString { n in "test.swift".withCString { f in tracy_zone_begin(n, f, 99) } }
    check(zCheck.id != 0 || zCheck.active == 0, "zone handle has valid id or inactive")
    tracy_zone_end(zCheck)
}
