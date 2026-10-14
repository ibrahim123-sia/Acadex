// Virus scanning hook. 'none' accepts everything; 'clamav' streams the file to clamd
// (INSTREAM protocol) and rejects anything it flags. A scanner outage fails closed.
import net from 'node:net';
import { getConfig } from '../config';

export type ScanResult = { status: 'clean' | 'skipped' } | { status: 'infected'; signature: string };

export interface VirusScanner {
  scan(body: Buffer): Promise<ScanResult>;
}

export const noScanner: VirusScanner = { scan: async () => ({ status: 'skipped' }) };

export function clamav(host: string, port: number, timeoutMs = 15000): VirusScanner {
  return {
    scan: (body) =>
      new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port });
        const chunks: Buffer[] = [];
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error('virus scanner timed out')));
        socket.on('error', reject);
        socket.on('data', (d: Buffer) => chunks.push(d));
        socket.on('end', () => {
          const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
          if (/: OK$/.test(reply)) resolve({ status: 'clean' });
          else if (/FOUND$/.test(reply)) resolve({ status: 'infected', signature: reply.replace(/^stream: /, '').replace(/ FOUND$/, '') });
          else reject(new Error(`unexpected virus scanner reply: ${reply}`));
        });
        socket.on('connect', () => {
          socket.write('zINSTREAM\0');
          for (let i = 0; i < body.length; i += 64 * 1024) {
            const part = body.subarray(i, i + 64 * 1024);
            const len = Buffer.alloc(4);
            len.writeUInt32BE(part.length);
            socket.write(len);
            socket.write(part);
          }
          socket.write(Buffer.alloc(4)); // zero-length chunk ends the stream
        });
      }),
  };
}

let scanner: VirusScanner | undefined;
export function virusScanner(): VirusScanner {
  if (!scanner) {
    const c = getConfig().virusScan;
    scanner = c.driver === 'clamav' ? clamav(c.host, c.port) : noScanner;
  }
  return scanner;
}
export function setVirusScanner(s: VirusScanner | undefined) {
  scanner = s;
}
