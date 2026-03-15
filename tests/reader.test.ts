/**
 * Tests for TracyReader
 * Tests binary file reading, header parsing, and decompression
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TracyReader, CompressionType } from '../src/reader.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('TracyReader', () => {
  const testTracePath = path.join(__dirname, '../demo/memory_test.tracy');

  describe('Header Reading', () => {
    it('should read a valid Tracy file header', () => {
      const reader = new TracyReader(testTracePath);
      const info = reader.getInfo();

      expect(info.version).toBe('1.0');
      expect(info.compressionType).toBe(CompressionType.Lz4);
      expect(info.streams).toBe(1);
      expect(info.fileSize).toBeGreaterThan(0);

      reader.close();
    });

    it('should throw error for non-existent file', () => {
      expect(() => new TracyReader('/nonexistent/file.tracy')).toThrow();
    });

    it('should throw error for invalid file', () => {
      const invalidFile = path.join(__dirname, 'invalid.tracy');
      fs.writeFileSync(invalidFile, Buffer.from([0x00, 0x01, 0x02, 0x03]));

      expect(() => new TracyReader(invalidFile)).toThrow();

      fs.unlinkSync(invalidFile);
    });
  });

  describe('Data Decompression', () => {
    it('should decompress LZ4 compressed data', async () => {
      const reader = new TracyReader(testTracePath);
      const data = await reader.readAllData();

      expect(data).toBeInstanceOf(Buffer);
      expect(data.length).toBeGreaterThan(0);
      // LZ4 decompresses to 64KB blocks
      expect(data.length).toBe(65536);

      reader.close();
    });

    it('should decompress multiple blocks if present', async () => {
      const reader = new TracyReader(testTracePath);
      const data = await reader.readAllData();

      // Should have at least some decompressed data
      expect(data.length).toBeGreaterThan(1000);

      reader.close();
    });
  });

  describe('Basic Info Extraction', () => {
    it('should extract basic information from trace', async () => {
      const reader = new TracyReader(testTracePath);
      const data = await reader.readAllData();
      const info = reader.extractBasicInfo(data);

      expect(info.approximateEventCount).toBeGreaterThan(0);

      reader.close();
    });
  });

  describe('File Handle Management', () => {
    it('should close file handle properly', () => {
      const reader = new TracyReader(testTracePath);
      // Should not throw when closing
      expect(() => reader.close()).not.toThrow();
    });
  });
});
