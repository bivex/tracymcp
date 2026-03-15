import * as fs from 'node:fs';
import * as lz4 from 'lz4';
import { decompress as zstdDecompress } from '@mongodb-js/zstd';

// Tracy file headers
const TRACY_HEADER = [0x74, 0x72, 0xfd, 0x50]; // 't', 'r', 253, 'P'
const LZ4_HEADER = [0x74, 0x6c, 0x5a, 0x04];  // 't', 'l', 'Z', 4
const ZSTD_HEADER = [0x74, 0x5a, 0x73, 0x74]; // 't', 'Z', 's', 't'

const FILE_BUF_SIZE = 64 * 1024;

export enum CompressionType {
  Lz4 = 0,
  Zstd = 1
}

export interface TracyFileInfo {
  version: string;
  compressionType: CompressionType;
  streams: number;
  fileSize: number;
}

export interface ZoneInfo {
  name: string;
  file?: string;
  function?: string;
  line?: number;
  color?: number;
}

export class TracyReader {
  private fd: number;
  private fileSize: number;
  private info: TracyFileInfo;
  private dataOffset: number = 0;

  constructor(filePath: string) {
    this.fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(this.fd);
    this.fileSize = stats.size;
    this.info = this.readHeader();
  }

  getInfo(): TracyFileInfo {
    return { ...this.info };
  }

  close(): void {
    if (this.fd !== -1) {
      fs.closeSync(this.fd);
    }
  }

  private readHeader(): TracyFileInfo {
    const header = this.readBytes(6);
    if (!header) {
      throw new Error('Failed to read header');
    }

    const h0 = header[0];
    const h1 = header[1];
    const h2 = header[2];
    const h3 = header[3];

    let compressionType: CompressionType;
    let streams = 1;

    if (h0 === TRACY_HEADER[0] && h1 === TRACY_HEADER[1] && h2 === TRACY_HEADER[2] && h3 === TRACY_HEADER[3]) {
      // New Tracy format
      compressionType = header[4];
      streams = header[5];
      this.dataOffset = 6;
    } else if (h0 === LZ4_HEADER[0] && h1 === LZ4_HEADER[1] && h2 === LZ4_HEADER[2] && h3 === LZ4_HEADER[3]) {
      compressionType = CompressionType.Lz4;
      this.dataOffset = 4;
    } else if (h0 === ZSTD_HEADER[0] && h1 === ZSTD_HEADER[1] && h2 === ZSTD_HEADER[2] && h3 === ZSTD_HEADER[3]) {
      compressionType = CompressionType.Zstd;
      this.dataOffset = 4;
    } else {
      throw new Error('Not a valid Tracy file');
    }

    return {
      version: '1.0',
      compressionType,
      streams,
      fileSize: this.fileSize
    };
  }

  private readBytes(size: number): Buffer | null {
    if (this.dataOffset + size > this.fileSize) {
      return null;
    }
    const buffer = Buffer.alloc(size);
    fs.readSync(this.fd, buffer, 0, size, this.dataOffset);
    this.dataOffset += size;
    return buffer;
  }

  // Read all data blocks and decompress them
  async readAllData(): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let currentOffset = this.dataOffset;

    while (currentOffset < this.fileSize) {
      const sizeBuf = Buffer.alloc(4);
      const readResult = fs.readSync(this.fd, sizeBuf, 0, 4, currentOffset);
      if (readResult !== 4) break;

      const blockSize = sizeBuf.readUInt32LE(0);
      if (blockSize === 0 || blockSize + currentOffset + 4 > this.fileSize) {
        break;
      }

      currentOffset += 4;
      const compressedData = Buffer.alloc(blockSize);
      fs.readSync(this.fd, compressedData, 0, blockSize, currentOffset);
      currentOffset += blockSize;

      const decompressed = await this.decompressBlock(compressedData);
      if (decompressed) {
        chunks.push(decompressed);
      }
    }

    return Buffer.concat(chunks);
  }

  private async decompressBlock(data: Buffer): Promise<Buffer | null> {
    try {
      if (this.info.compressionType === CompressionType.Lz4) {
        const outputBuffer = Buffer.alloc(FILE_BUF_SIZE);
        const decompressedSize = lz4.decodeBlock(data, outputBuffer);
        if (decompressedSize < 0) {
          return null;
        }
        return outputBuffer.subarray(0, decompressedSize);
      } else {
        // Zstd decompression
        const decompressed = await zstdDecompress(data);
        return Buffer.from(decompressed);
      }
    } catch (e) {
      console.error('Decompression error:', e);
      return null;
    }
  }

  // Extract basic information from the decompressed data
  extractBasicInfo(data: Buffer): { stringCount: number; sourceLocationCount: number; approximateEventCount: number } {
    // This is a very basic heuristic - the actual format is much more complex
    // We're counting potential string data and source location markers
    let stringCount = 0;
    let sourceLocationCount = 0;
    let eventCount = 0;

    // Look for null-terminated strings (potential string data)
    for (let i = 0; i < data.length - 1; i++) {
      if (data[i] === 0 && data[i + 1] > 32 && data[i + 1] < 127) {
        stringCount++;
      }
    }

    // Approximate event count based on data size
    eventCount = Math.floor(data.length / 32);

    return {
      stringCount,
      sourceLocationCount,
      approximateEventCount: eventCount
    };
  }

  // Search for zone names in the decompressed data
  // This is a heuristic approach - the actual parsing requires understanding the full event format
  findPotentialZones(data: Buffer, filter?: string): ZoneInfo[] {
    const zones: ZoneInfo[] = [];
    const seen = new Set<string>();

    // Look for patterns that might be zone names
    // Zone names are typically stored as null-terminated strings
    let currentString = '';
    let inString = false;

    for (let i = 0; i < data.length; i++) {
      const byte = data[i];

      // Printable ASCII
      if (byte >= 32 && byte < 127) {
        currentString += String.fromCharCode(byte);
        inString = true;
      } else {
        // End of string
        if (inString && currentString.length > 2 && currentString.length < 100) {
          // Filter out common non-zone strings
          if (!currentString.match(/^(src|main|void|int|char|const|static|return|if|else|for|while|true|false|null|undefined)$/)) {
            // Apply filter if provided
            if (!filter || currentString.toLowerCase().includes(filter.toLowerCase())) {
              if (!seen.has(currentString)) {
                seen.add(currentString);
                zones.push({ name: currentString });
              }
            }
          }
        }
        currentString = '';
        inString = false;
      }
    }

    return zones;
  }
}

