// A small ZIP writer (deflate, no dependencies) for data exports: CSV per table and files.
import zlib from 'node:zlib';

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  compressed: number;
  offset: number;
  method: number;
}

/** Collects files and returns one ZIP archive. */
export class ZipWriter {
  private parts: Buffer[] = [];
  private entries: Entry[] = [];
  private offset = 0;

  add(name: string, data: Buffer | string): void {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const deflated = zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const nameBuf = Buffer.from(name.replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const crc = zlib.crc32(raw) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0x21, 12); // date: 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    this.parts.push(header, nameBuf, body);
    this.entries.push({ name: nameBuf, crc, size: raw.length, compressed: body.length, offset: this.offset, method: useDeflate ? 8 : 0 });
    this.offset += header.length + nameBuf.length + body.length;
  }

  finish(): Buffer {
    const central: Buffer[] = [];
    let size = 0;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(0, 12);
      h.writeUInt16LE(0x21, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      central.push(h, e.name);
      size += h.length + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.offset, 16);
    return Buffer.concat([...this.parts, ...central, end]);
  }
}

/** Reads the names and contents of a ZIP made by ZipWriter (tests). */
export function readZip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let p = 0;
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const compressed = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extra;
    const body = buf.subarray(start, start + compressed);
    out[name] = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    p = start + compressed;
  }
  return out;
}
