/** Source PMTiles lisant un fichier local (Node), avec compteur d'octets lus. */
import { open, type FileHandle } from 'node:fs/promises';

import type { RangeResponse, Source } from 'pmtiles';

export class NodeFileSource implements Source {
  bytesRead = 0;
  requests = 0;
  private path: string;
  private handle: Promise<FileHandle>;

  constructor(path: string) {
    this.path = path;
    this.handle = open(path, 'r');
  }

  getKey() {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await (await this.handle).read(buf, 0, length, offset);
    this.bytesRead += bytesRead;
    this.requests++;
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead) };
  }

  async close() {
    await (await this.handle).close();
  }
}
