# Makefile for Tracy Demo
# Builds the demo program with Tracy profiling

TRACY_ROOT = ../..
TRACY_LIB_DIR = $(TRACY_ROOT)/build
CC = gcc
CXX = g++
CFLAGS = -O2 -Wall -Wextra -DTRACY_ENABLE
CXXFLAGS = -O2 -Wall -Wextra -DTRACY_ENABLE -std=c++17
INCLUDES = -I$(TRACY_ROOT)/public

# Directories
BUILD_DIR = build
DEMO_BUILD_DIR = $(BUILD_DIR)/demo

# Libraries - Tracy client + C++ runtime
LIBS = -L$(TRACY_LIB_DIR) -lTracyClient -lpthread -ldl -lc++ -lstdc++

.PHONY: all clean dirs run demo build_all

all: build_all

build_all: dirs $(DEMO_BUILD_DIR)/demo $(DEMO_BUILD_DIR)/demo_memory

dirs:
	@mkdir -p $(DEMO_BUILD_DIR)

# Build original demo (CPU profiling only)
$(DEMO_BUILD_DIR)/demo: demo.c
	@echo "Building CPU profiling demo..."
	@$(CC) -std=c11 $(CFLAGS) $(INCLUDES) -o $@ $< $(LIBS)
	@echo "Demo built: $@"

# Build memory demo (CPU + memory profiling, C++ Tracy client)
$(DEMO_BUILD_DIR)/demo_memory: demo_memory.c
	@echo "Building memory profiling demo (C++)..."
	@$(CXX) $(CXXFLAGS) $(INCLUDES) -I$(TRACY_ROOT)/public/tracy -o $@ $< $(LIBS)
	@echo "Memory demo built: $@"

run: $(DEMO_BUILD_DIR)/demo
	@echo "Running CPU profiling demo..."
	@$(DEMO_BUILD_DIR)/demo

run_memory: $(DEMO_BUILD_DIR)/demo_memory
	@echo "Running memory profiling demo..."
	@$(DEMO_BUILD_DIR)/demo_memory

demo: run

demo_mem: run_memory

clean:
	@echo "Cleaning build directory..."
	@rm -rf $(BUILD_DIR)
