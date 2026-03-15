#!/usr/bin/env python3
"""Create a minimal test .tracy file"""

import struct
import lz4

# Tracy file header for LZ4 compression
# Format: 't', 'l', 'Z', 4 (magic bytes for LZ4 compressed trace)
header = bytes([0x74, 0x6c, 0x5a, 0x04])

# Create some fake zone data that would be in a real trace
# This is just placeholder data for testing
test_data = b"""
main
heavy_work
process_data
initialize
processing_loop
cleanup
fast_operation
memory_demo
database_query
connect
execute_query
fetch_results
frame_0
physics_update
culling
render
present
frame_1
frame_2
frame_3
frame_4
UpdatePhysics
RenderScene
ProcessInput
GameLoop
FrameTick
"""

# Compress with LZ4 (Tracy uses 64KB blocks)
BLOCK_SIZE = 64 * 1024

# Pad data to block size
padded_data = test_data.ljust(BLOCK_SIZE, b'\x00')

# Compress the block
compressed = lz4.block.compress(padded_data, store_size=False)

# Write the trace file
output_path = 'test.tracy'
with open(output_path, 'wb') as f:
    f.write(header)
    # Write block size (little-endian uint32)
    f.write(struct.pack('<I', len(compressed)))
    # Write compressed data
    f.write(compressed)

print(f"Created test trace file: {output_path}")
print(f"Header: {header.hex()}")
print(f"Block size: {len(compressed)} bytes")
