# Tracy Swift GUI Demo — macOS AppKit app + tests
# Usage:
#   make           — build app binary
#   make test      — build + run tests
#   make run       — capture trace + run app (tracy-capture must be available)
#   make clean

TRACY_ROOT   = ../../..
TRACY_LIB    = $(TRACY_ROOT)/build/libTracyClient.a
TRACY_CAP    = $(TRACY_ROOT)/capture/build/tracy-capture
TRACY_INC    = $(TRACY_ROOT)/public

BUILD_DIR    = build
APP_BIN      = $(BUILD_DIR)/swift_gui_demo
TEST_BIN     = $(BUILD_DIR)/test_runner
TRACE        = $(BUILD_DIR)/swift_gui_demo.tracy

BRIDGE_H     = tracy_bridge.h
BRIDGE_C     = tracy_bridge.c
BRIDGE_OBJ   = $(BUILD_DIR)/tracy_bridge.o

CC           = clang
CFLAGS       = -O2 -DTRACY_ENABLE -I$(TRACY_INC)

SWIFTC       = swiftc
SWIFTFLAGS   = -O -import-objc-header $(BRIDGE_H) -Xcc -DTRACY_ENABLE

APP_SRCS     = Sources/main.swift \
               Sources/AppDelegate.swift \
               Sources/ParticleScene.swift \
               Sources/ImageScene.swift \
               Sources/DataScene.swift

TEST_SRCS    = Tests/main.swift \
               Tests/BridgeTests.swift \
               Tests/SceneTests.swift

.PHONY: all test run clean

all: $(APP_BIN)

$(BUILD_DIR):
	@mkdir -p $(BUILD_DIR)

$(BRIDGE_OBJ): $(BRIDGE_C) $(BRIDGE_H) | $(BUILD_DIR)
	@echo "  CC  $(BRIDGE_C)"
	$(CC) -c $(CFLAGS) -I$(TRACY_INC) -o $@ $<

$(APP_BIN): $(APP_SRCS) $(BRIDGE_OBJ) $(TRACY_LIB) | $(BUILD_DIR)
	@echo "  SWIFTC  app"
	$(SWIFTC) $(SWIFTFLAGS) \
	    $(APP_SRCS) \
	    $(BRIDGE_OBJ) $(TRACY_LIB) \
	    -Xlinker -lc++ \
	    -framework AppKit \
	    -o $@
	@echo "  Built: $@"

$(TEST_BIN): $(TEST_SRCS) $(BRIDGE_OBJ) $(TRACY_LIB) | $(BUILD_DIR)
	@echo "  SWIFTC  tests"
	$(SWIFTC) $(SWIFTFLAGS) \
	    $(TEST_SRCS) \
	    $(BRIDGE_OBJ) $(TRACY_LIB) \
	    -Xlinker -lc++ \
	    -o $@
	@echo "  Built: $@"

test: $(TEST_BIN)
	@echo "\nRunning tests...\n"
	@$(TEST_BIN)

run: $(APP_BIN)
	@echo "Starting tracy-capture..."
	@$(TRACY_CAP) -o $(TRACE) -f &
	@sleep 1
	@echo "Running GUI demo (9 seconds)..."
	@$(APP_BIN)
	@sleep 2
	@echo "Trace: $(TRACE)"
	@ls -lh $(TRACE) 2>/dev/null || echo "(trace not saved — no profiler connected)"

clean:
	@rm -rf $(BUILD_DIR)
