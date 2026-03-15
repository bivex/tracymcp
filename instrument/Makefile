# Makefile for TracyMemPro Demo
#
# Build:
#   make              - Build demo_mempro
#   make clean        - Clean build artifacts
#   make run          - Build and run demo
#
# Requirements:
#   - Tracy Profiler (https://github.com/wolfpld/tracy)
#   - Set TRACY_ROOT to Tracy source directory

# Tracy root directory - adjust to your Tracy installation
TRACY_ROOT ?= /Volumes/External/Code/tracy

# Compiler
CXX = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra -DTRACY_ENABLE

# Include paths
INCLUDES = -I$(TRACY_ROOT)/public

# Libraries
LIBS = -L$(TRACY_ROOT)/build -lTracyClient -lpthread -ldl -lstdc++

# Directories
BUILD_DIR = build
DEMO_BUILD_DIR = $(BUILD_DIR)
TARGET = $(DEMO_BUILD_DIR)/demo_mempro

.PHONY: all clean run dirs test_stub

all: dirs $(TARGET)

dirs:
	@mkdir -p $(DEMO_BUILD_DIR)

# Build demo with MemPro-style instrumentation
$(TARGET): demo_mempro.cpp TracyMemPro.hpp
	@echo "Building TracyMemPro demo..."
	@$(CXX) $(CXXFLAGS) $(INCLUDES) \
		-DTRACY_MEMPRO_ENABLE \
		-DTRACY_MEMPRO_OVERRIDE_NEW_DELETE \
		-o $@ $< $(LIBS)
	@echo "Demo built: $@"
	@echo ""
	@echo "To run:"
	@echo "  1. Start Tracy Profiler"
	@echo "  2. Run: $(TARGET)"
	@echo "  3. Capture trace and save as .tracy file"
	@echo "  4. Analyze with: find_memory_leaks(path=\"trace.tracy\")"

run: $(TARGET)
	@echo "Running TracyMemPro demo..."
	@echo "Make sure Tracy Profiler is running!"
	@echo ""
	@$(TARGET)

clean:
	@echo "Cleaning build directory..."
	@rm -rf $(BUILD_DIR)
	@rm -f test_stub

# Test stub version (no Tracy dependency)
test_stub: test_stub.cpp TracyMemPro.hpp
	@echo "Building stub test (no Tracy required)..."
	@$(CXX) $(CXXFLAGS) -o test_stub test_stub.cpp
	@echo "Running stub test..."
	@./test_stub
