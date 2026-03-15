# Tracy Swift Demo Makefile
#
# Usage:
#   make              — build swift_demo binary
#   make run          — capture + run (requires tracy-capture in PATH or TRACY_ROOT)
#   make capture      — start tracy-capture in background
#   make clean

TRACY_ROOT   = ../../..
TRACY_LIB    = $(TRACY_ROOT)/build/libTracyClient.a
TRACY_CAPS   = $(TRACY_ROOT)/capture/build/tracy-capture
TRACY_CSV    = $(TRACY_ROOT)/csvexport/build/tracy-csvexport
TRACY_INC    = $(TRACY_ROOT)/public

BUILD_DIR    = build
BINARY       = $(BUILD_DIR)/swift_demo
TRACE        = $(BUILD_DIR)/swift_demo.tracy

BRIDGE_SRC   = tracy_bridge.c
BRIDGE_OBJ   = $(BUILD_DIR)/tracy_bridge.o
BRIDGE_H     = tracy_bridge.h
SWIFT_SRC    = main.swift

CC           = clang
CFLAGS       = -O2 -DTRACY_ENABLE -I$(TRACY_INC)

SWIFTC       = swiftc
SWIFTFLAGS   = -O -import-objc-header $(BRIDGE_H) -Xcc -DTRACY_ENABLE

.PHONY: all run capture clean

all: $(BINARY)

$(BUILD_DIR):
	@mkdir -p $(BUILD_DIR)

# 1. Compile C bridge
$(BRIDGE_OBJ): $(BRIDGE_SRC) $(BRIDGE_H) | $(BUILD_DIR)
	@echo "  CC  $(BRIDGE_SRC)"
	$(CC) -c $(CFLAGS) -o $@ $<

# 2. Compile Swift + link everything
$(BINARY): $(SWIFT_SRC) $(BRIDGE_OBJ) $(TRACY_LIB) | $(BUILD_DIR)
	@echo "  SWIFTC  $(SWIFT_SRC)"
	$(SWIFTC) $(SWIFTFLAGS) \
	    $(SWIFT_SRC) \
	    $(BRIDGE_OBJ) \
	    $(TRACY_LIB) \
	    -Xlinker -lc++ \
	    -o $@
	@echo "  Built: $@"

# Start capture in background, run demo, wait for save
run: $(BINARY)
	@echo "Starting tracy-capture..."
	@$(TRACY_CAPS) -o $(TRACE) -f &
	@sleep 1
	@echo "Running Swift demo..."
	@$(BINARY)
	@sleep 2
	@echo "Trace saved: $(TRACE)"
	@ls -lh $(TRACE)

# Just start capture (run the demo manually in another terminal)
capture:
	@echo "Listening for Tracy connection — run './$(BINARY)' in another terminal"
	$(TRACY_CAPS) -o $(TRACE) -f

clean:
	@rm -rf $(BUILD_DIR)
