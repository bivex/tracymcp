#!/usr/bin/env node
/**
 * Simulate a realistic C++ program with new/delete hooks reporting to Tracy.
 *
 * Scenario: a game engine frame loop where several subsystems have bugs:
 *
 *   1. TextureCache     — loads textures, never evicts  → 21 MB leaked
 *   2. SceneGraph       — allocates nodes, forgets half → 2 MB leaked
 *   3. ShaderConstants  — per-draw-call structs, ~500   → 128 KB leaked
 *   4. NetworkQueue     — packets accumulate            → 512 KB leaked
 *   5. ParticleBuffer   — 8 MB spike, properly freed   (healthy)
 *   6. RenderTarget     — 32 MB spike, properly freed  (healthy)
 *   7. AudioBuffer      — 1 MB/frame × 30, all freed   (healthy)
 *
 * QueueType values (from TracyQueue.hpp, 0-based enum):
 *   MemAlloc(25)  MemAllocNamed(26)  MemFree(27)
 *   StringData(104)  MemNamePayload(101)
 *
 * Binary layout per event (no QueueHeader — raw event stream):
 *   MemAlloc:       [25] + time(8) + thread(4) + ptr(8) + size(6)   = 27 bytes
 *   MemAllocNamed:  [26] + time(8) + thread(4) + ptr(8) + size(6)   = 27 bytes
 *   MemFree:        [27] + time(8) + thread(4) + ptr(8)             = 21 bytes
 *   StringData:     [104] + namePtr(8) + str + NUL
 *   MemNamePayload: [101] + namePtr(8)                              = 9 bytes
 */

'use strict';

const fs   = require('fs');
const lz4  = require('lz4');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function i64(v) {
  const b = Buffer.alloc(8);
  b.writeUInt32LE(v % 0x100000000, 0);
  b.writeUInt32LE(Math.floor(v / 0x100000000), 4);
  return b;
}

function u64(v) { return i64(v); }

function size48(v) {
  const b = Buffer.alloc(6);
  b.writeUInt32LE(v % 0x100000000, 0);
  b.writeUInt16LE(Math.floor(v / 0x100000000), 4);
  return b;
}

// ── event builders ───────────────────────────────────────────────────────────

const THREAD_MAIN    = 0x00001234;
const THREAD_RENDER  = 0x00005678;
const THREAD_NETWORK = 0x00009ABC;

let ptrCounter = 0x10000000n;
function nextPtr() { return ptrCounter += 0x1000n; }

// Register a name string and return the namePtr (uint64 used as key)
let namePtrCounter = 0xF0000000n;
const nameRegistry = new Map(); // name string → namePtrBigInt
function registerName(events, str) {
  if (!nameRegistry.has(str)) {
    const nptr = namePtrCounter += 1n;
    nameRegistry.set(str, nptr);
    // StringData: [104] + namePtr(8) + str + NUL
    events.push(Buffer.from([104]));
    events.push(u64(Number(nptr)));
    events.push(Buffer.from(str + '\0', 'utf8'));
  }
  return nameRegistry.get(str);
}

function memAlloc(events, t, ptr, bytes, thread = THREAD_MAIN) {
  events.push(Buffer.from([25]));
  events.push(i64(t));
  events.push(u32(thread));
  events.push(u64(Number(ptr)));
  events.push(size48(bytes));
}

function memAllocNamed(events, t, ptr, bytes, name, thread = THREAD_MAIN) {
  const nptr = registerName(events, name);
  events.push(Buffer.from([26]));           // MemAllocNamed
  events.push(i64(t));
  events.push(u32(thread));
  events.push(u64(Number(ptr)));
  events.push(size48(bytes));
  events.push(Buffer.from([101]));          // MemNamePayload
  events.push(u64(Number(nptr)));           // → looks up string in map
}

function memFree(events, t, ptr, thread = THREAD_MAIN) {
  events.push(Buffer.from([27]));
  events.push(i64(t));
  events.push(u32(thread));
  events.push(u64(Number(ptr)));
}

function memCallstack(events, ptr, frames) {
  // Emit StringData for each unique function/file name, then the custom event.
  const funcPtrs = frames.map(f => registerName(events, f.fn));
  const filePtrs = frames.map(f => registerName(events, f.file));
  events.push(Buffer.from([200]));           // MemCallstack type
  events.push(u64(Number(ptr)));             // allocation ptr
  events.push(Buffer.from([frames.length])); // frameCount
  for (let i = 0; i < frames.length; i++) {
    events.push(u64(Number(funcPtrs[i])));   // funcPtr
    events.push(u64(Number(filePtrs[i])));   // filePtr
    events.push(u32(frames[i].line));        // line
  }
}

// ── scenario ─────────────────────────────────────────────────────────────────

function buildEventStream() {
  const events = [];
  let t = 1_000_000; // nanoseconds since start

  const tick = (ns) => { t += ns; return t; };

  // ── 1. TextureCache — loads 3 textures, NEVER frees them ─────────────────
  //    Simulates a cache that doesn't have an eviction policy.
  const tex1 = nextPtr(); memAllocNamed(events, tick(1e6),  tex1, 512*512*4,    'TextureCache/skybox.dds');
  memCallstack(events, tex1, [
    {fn: 'Texture::AllocPixelData',   file: 'texture.cpp',       line: 42},
    {fn: 'TextureCache::Load',        file: 'texture_cache.cpp', line: 89},
    {fn: 'GameEngine::LoadAssets',    file: 'engine.cpp',        line: 234},
  ]);
  const tex2 = nextPtr(); memAllocNamed(events, tick(2e6),  tex2, 1024*1024*4,  'TextureCache/terrain_diffuse.dds');
  memCallstack(events, tex2, [
    {fn: 'Texture::AllocPixelData',   file: 'texture.cpp',       line: 42},
    {fn: 'TextureCache::Load',        file: 'texture_cache.cpp', line: 96},
    {fn: 'LevelManager::LoadChunk',   file: 'level_manager.cpp', line: 178},
  ]);
  const tex3 = nextPtr(); memAllocNamed(events, tick(1e6),  tex3, 2048*2048*4,  'TextureCache/terrain_normal.dds');
  memCallstack(events, tex3, [
    {fn: 'Texture::AllocPixelData',   file: 'texture.cpp',       line: 42},
    {fn: 'TextureCache::Load',        file: 'texture_cache.cpp', line: 96},
    {fn: 'LevelManager::LoadChunk',   file: 'level_manager.cpp', line: 179},
  ]);
  // tex1: 1 MB, tex2: 4 MB, tex3: 16 MB  →  21 MB leaked

  // ── 2. SceneGraph — allocates 20 nodes, forgets to free 10 ───────────────
  //    Common bug: removeNode() doesn't delete the object.
  const nodes = [];
  for (let i = 0; i < 20; i++) {
    const p = nextPtr();
    nodes.push(p);
    memAllocNamed(events, tick(50_000), p, 1024*200, `SceneGraph/node_${i}`);  // 200 KB each
  }
  // Free the even-indexed nodes, leak the odd ones (10 × 200 KB = 2 MB)
  for (let i = 0; i < 20; i += 2) {
    memFree(events, tick(20_000), nodes[i]);
  }

  // ── 3. ParticleBuffer — 8 MB spike, properly freed (healthy) ─────────────
  const particle = nextPtr();
  memAllocNamed(events, tick(500_000), particle, 8*1024*1024, 'ParticleSystem/vertex_buffer');
  tick(10_000_000); // used for 10ms
  memFree(events, tick(200_000), particle);

  // ── 4. RenderTarget — 32 MB ping-pong, both freed (healthy) ──────────────
  const rt0 = nextPtr(); memAllocNamed(events, tick(1e6),  rt0, 1920*1080*4, 'RenderTarget/color_0');
  const rt1 = nextPtr(); memAllocNamed(events, tick(100),  rt1, 1920*1080*4, 'RenderTarget/color_1');
  const rt2 = nextPtr(); memAllocNamed(events, tick(100),  rt2, 1920*1080*4*4, 'RenderTarget/hdr_buffer');
  tick(33_000_000); // one frame
  memFree(events, tick(100_000), rt0);
  memFree(events, tick(100),     rt1);
  memFree(events, tick(100),     rt2);

  // ── 5. ShaderConstants — per-draw-call struct, ~500 never freed ───────────
  //    Bug: a draw call recorder allocates a constants struct but the
  //    "release" path is only called on success, not on early-return.
  const shaderPtrs = [];
  for (let i = 0; i < 500; i++) {
    const p = nextPtr();
    shaderPtrs.push(p);
    memAllocNamed(events, tick(10_000), p, 256, 'ShaderConstants');
  }
  // Only 200 of them are freed (the "success" path)
  for (let i = 0; i < 200; i++) {
    memFree(events, tick(5_000), shaderPtrs[i]);
  }
  // 300 × 256 B = 75 KB leaked

  // Representative callstack for leaked ShaderConstants
  if (shaderPtrs.length > 200) {
    memCallstack(events, shaderPtrs[200], [
      {fn: 'DrawCallRecorder::AllocConstants', file: 'draw_call.cpp',   line: 67},
      {fn: 'RenderQueue::Submit',              file: 'render_queue.cpp', line: 112},
      {fn: 'Renderer::DrawFrame',              file: 'renderer.cpp',     line: 298},
    ]);
  }

  // ── 6. AudioBuffer — 1 MB per frame × 30 frames, all freed (healthy) ─────
  for (let frame = 0; frame < 30; frame++) {
    const ab = nextPtr();
    memAllocNamed(events, tick(1e6),       ab, 1024*1024, 'AudioMixer/frame_buffer');
    tick(16_600_000); // ~60 fps
    memFree(events, tick(50_000), ab);
  }

  // ── 7. NetworkQueue — packets accumulate (ring buffer never drained) ──────
  //    Bug: consumer thread exits but producer keeps going.
  const packets = [];
  for (let i = 0; i < 64; i++) {
    const p = nextPtr();
    packets.push(p);
    memAllocNamed(events, tick(100_000), p, 8*1024, 'NetworkQueue/packet', THREAD_NETWORK);
  }
  // Only the first 16 are consumed
  for (let i = 0; i < 16; i++) {
    memFree(events, tick(50_000), packets[i], THREAD_NETWORK);
  }
  // 48 × 8 KB = 384 KB leaked

  // ── 8. Circular-reference simulation — RefCounted objects ─────────────────
  //    Two objects hold shared_ptr to each other → ref counts never hit zero.
  const objA = nextPtr(); memAllocNamed(events, tick(200_000), objA, 4*1024*1024, 'RefCounted/PhysicsWorld');
  memCallstack(events, objA, [
    {fn: 'PhysicsWorld::PhysicsWorld', file: 'physics_world.cpp', line: 15},
    {fn: 'Scene::Init',                file: 'scene.cpp',         line: 83},
  ]);
  const objB = nextPtr(); memAllocNamed(events, tick(100_000), objB, 2*1024*1024, 'RefCounted/CollisionMesh');
  memCallstack(events, objB, [
    {fn: 'CollisionMesh::CollisionMesh', file: 'collision_mesh.cpp', line: 22},
    {fn: 'PhysicsWorld::',   file: 'physics_world.cpp',  line: 57},
    {fn: 'Scene::Init',                  file: 'scene.cpp',          line: 84},
  ]);
  // Neither is freed — simulates circular shared_ptr cycle (6 MB leaked)

  // ── 9. Giant temporary — image decode scratch buffer (healthy) ────────────
  const scratch = nextPtr();
  memAllocNamed(events, tick(5e6), scratch, 64*1024*1024, 'ImageDecoder/scratch_4k');
  tick(80_000_000);
  memFree(events, tick(1e6), scratch);

  return Buffer.concat(events);
}

// ── write .tracy file ─────────────────────────────────────────────────────────

function write(outPath) {
  const BLOCK = 64 * 1024;
  const raw   = buildEventStream();

  // Pad to block size
  const padded = Buffer.alloc(BLOCK);
  raw.copy(padded);

  const compressed = Buffer.alloc(BLOCK);
  const cSize = lz4.encodeBlock(padded, compressed);

  const header = Buffer.from([0x74, 0x72, 0xfd, 0x50, 0x00, 0x01]); // tr\xfdP LZ4 1-stream
  const szBuf  = Buffer.alloc(4); szBuf.writeUInt32LE(cSize, 0);

  const out = Buffer.concat([header, szBuf, compressed.subarray(0, cSize)]);
  fs.writeFileSync(outPath, out);

  console.log(`Wrote ${outPath}  (${out.length} bytes)`);
  console.log(`  raw events : ${raw.length} bytes`);
  console.log(`  compressed : ${cSize} bytes`);
  console.log();
  console.log('Expected leaks:');
  console.log('  TextureCache      skybox + terrain_diffuse + terrain_normal  ≈ 21 MB');
  console.log('  SceneGraph        10 of 20 nodes not freed                   ≈  2 MB');
  console.log('  ShaderConstants   300 of 500 structs not freed               ≈ 75 KB');
  console.log('  NetworkQueue      48 of 64 packets not consumed              ≈ 384 KB');
  console.log('  RefCounted/cycle  PhysicsWorld + CollisionMesh               ≈  6 MB');
  console.log();
  console.log('Healthy (all freed):');
  console.log('  ParticleSystem    8 MB spike');
  console.log('  RenderTarget      32 MB ping-pong');
  console.log('  AudioMixer        1 MB/frame × 30');
  console.log('  ImageDecoder      64 MB scratch');
}

const out = path.join(__dirname, 'leaky_engine.tracy');
write(out);
