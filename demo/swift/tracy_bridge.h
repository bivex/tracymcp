/**
 * tracy_bridge.h — Swift-friendly C bridge to Tracy Profiler
 *
 * Import this via Bridging Header:
 *   swiftc -import-objc-header tracy_bridge.h ...
 *
 * This header exposes ONLY plain C types so Swift can import it without
 * seeing Tracy's complex C++ internals.
 */

#pragma once
#include <stddef.h>
#include <stdint.h>

// ── Zone handle ───────────────────────────────────────────────────────────────
// Same layout as Tracy's TracyCZoneCtx { uint32_t id; int32_t active; }
typedef struct {
    uint32_t id;
    int32_t  active;
} TZone;

// ── Zones ─────────────────────────────────────────────────────────────────────
// Begin a zone with dynamic name + source location
TZone tracy_zone_begin (const char* name, const char* file, uint32_t line);
void  tracy_zone_end   (TZone zone);
void  tracy_zone_color (TZone zone, uint32_t rgb);   // 0xRRGGBB
void  tracy_zone_text  (TZone zone, const char* txt, size_t len);

// ── Messages (appear in the log panel) ───────────────────────────────────────
// severity: 0=Trace 1=Debug 2=Info 3=Warning 4=Error 5=Fatal
void tracy_message       (int8_t severity, int32_t color, const char* txt, size_t len);
void tracy_message_l     (int8_t severity, int32_t color, const char* txt); // literal

// ── Frame marks ──────────────────────────────────────────────────────────────
void tracy_frame_mark        (void);              // default frame group
void tracy_frame_mark_named  (const char* name);  // named frame group

// ── Memory tracking ───────────────────────────────────────────────────────────
void tracy_mem_alloc  (const void* ptr, size_t size);
void tracy_mem_free   (const void* ptr);
void tracy_mem_alloc_n(const void* ptr, size_t size, const char* name);
void tracy_mem_free_n (const void* ptr, const char* name);

// ── Plots ─────────────────────────────────────────────────────────────────────
void tracy_plot      (const char* name, double val);
void tracy_plot_int  (const char* name, int64_t val);

// ── Thread name ───────────────────────────────────────────────────────────────
void tracy_set_thread_name(const char* name);
