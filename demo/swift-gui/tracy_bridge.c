/**
 * tracy_bridge.c — C implementation of the Swift bridge.
 *
 * Compiled as plain C; links against libTracyClient.a (C++ lib).
 * Tracy's internal functions use extern "C" linkage so C callers work fine.
 */

#include "tracy/TracyC.h"
#include "tracy_bridge.h"

#include <string.h>
#include <assert.h>

// Verify our TZone matches TracyCZoneCtx at compile time
typedef char _zone_size_check[sizeof(TZone) == sizeof(TracyCZoneCtx) ? 1 : -1];

// ── Zones ─────────────────────────────────────────────────────────────────────

TZone tracy_zone_begin(const char* name, const char* file, uint32_t line) {
    uint64_t srcloc = ___tracy_alloc_srcloc_name(
        line,
        file, strlen(file),
        "swift", 5,
        name, strlen(name),
        0   /* color — set later via tracy_zone_color */
    );
    TracyCZoneCtx ctx = ___tracy_emit_zone_begin_alloc(srcloc, 1);
    TZone z = { ctx.id, ctx.active };
    return z;
}

void tracy_zone_end(TZone zone) {
    TracyCZoneCtx ctx = { zone.id, zone.active };
    ___tracy_emit_zone_end(ctx);
}

void tracy_zone_color(TZone zone, uint32_t rgb) {
    TracyCZoneCtx ctx = { zone.id, zone.active };
    ___tracy_emit_zone_color(ctx, rgb);
}

void tracy_zone_text(TZone zone, const char* txt, size_t len) {
    TracyCZoneCtx ctx = { zone.id, zone.active };
    ___tracy_emit_zone_text(ctx, txt, len);
}

// ── Messages ──────────────────────────────────────────────────────────────────

void tracy_message(int8_t severity, int32_t color, const char* txt, size_t len) {
    ___tracy_emit_logString(severity, color, 0, len, txt);
}

void tracy_message_l(int8_t severity, int32_t color, const char* txt) {
    ___tracy_emit_logStringL(severity, color, 0, txt);
}

// ── Frame marks ──────────────────────────────────────────────────────────────

void tracy_frame_mark(void) {
    ___tracy_emit_frame_mark(NULL);
}

void tracy_frame_mark_named(const char* name) {
    ___tracy_emit_frame_mark(name);
}

// ── Memory ────────────────────────────────────────────────────────────────────

void tracy_mem_alloc(const void* ptr, size_t size) {
    ___tracy_emit_memory_alloc(ptr, size, 0);
}

void tracy_mem_free(const void* ptr) {
    ___tracy_emit_memory_free(ptr, 0);
}

void tracy_mem_alloc_n(const void* ptr, size_t size, const char* name) {
    ___tracy_emit_memory_alloc_named(ptr, size, 0, name);
}

void tracy_mem_free_n(const void* ptr, const char* name) {
    ___tracy_emit_memory_free_named(ptr, 0, name);
}

// ── Plots ─────────────────────────────────────────────────────────────────────

void tracy_plot(const char* name, double val) {
    ___tracy_emit_plot(name, val);
}

void tracy_plot_int(const char* name, int64_t val) {
    ___tracy_emit_plot_int(name, val);
}

// ── Thread name ───────────────────────────────────────────────────────────────

void tracy_set_thread_name(const char* name) {
    ___tracy_set_thread_name(name);
}
