/**
 * Bounded upload body reader (A7.2): a hard byte counter (a lying or absent Content-Length does not
 * help the sender), an idle timeout between chunks, and an incremental SHA-256. On any rejection the
 * reader stops consuming (the route then answers and closes the connection).
 */
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export class BodyTooLargeError extends Error {
  constructor() {
    super('body too large');
    this.name = 'BodyTooLargeError';
  }
}

export class BodyIdleError extends Error {
  constructor() {
    super('body idle');
    this.name = 'BodyIdleError';
  }
}

export class BodyAbortedError extends Error {
  constructor() {
    super('body aborted');
    this.name = 'BodyAbortedError';
  }
}

export interface ReadBody {
  bytes: Uint8Array;
  sha256: string;
}

export function readLimitedBody(stream: Readable, opts: { limit: number; idleMs: number; expectedLength?: number | undefined }): Promise<ReadBody> {
  return new Promise<ReadBody>((resolve, reject) => {
    const hash = createHash('sha256');
    const initial = Math.min(Math.max(opts.expectedLength ?? 64 * 1024, 1), opts.limit);
    let buf = Buffer.allocUnsafe(initial);
    let len = 0;
    let done = false;
    let idle: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (idle) clearTimeout(idle);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('aborted', onAborted);
      stream.off('close', onClose);
    };
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      cleanup();
      stream.pause();
      reject(e);
    };
    const arm = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => fail(new BodyIdleError()), opts.idleMs);
    };
    const onData = (chunk: Buffer) => {
      if (done) return;
      arm();
      if (len + chunk.length > opts.limit) {
        fail(new BodyTooLargeError());
        return;
      }
      if (len + chunk.length > buf.length) {
        const next = Buffer.allocUnsafe(Math.min(opts.limit, Math.max(buf.length * 2, len + chunk.length)));
        buf.copy(next, 0, 0, len);
        buf = next;
      }
      chunk.copy(buf, len);
      len += chunk.length;
      hash.update(chunk);
    };
    const onEnd = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve({ bytes: new Uint8Array(buf.buffer, buf.byteOffset, len), sha256: hash.digest('hex') });
    };
    const onError = () => fail(new BodyAbortedError());
    const onAborted = () => fail(new BodyAbortedError());
    const onClose = () => {
      // 'close' before 'end' means the client went away mid-body.
      if (!done) fail(new BodyAbortedError());
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    stream.on('aborted', onAborted);
    stream.on('close', onClose);
    arm();
    stream.resume();
  });
}
