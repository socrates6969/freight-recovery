/** Minimal XMLHttpRequest double for upload tests: records requests, emits progress, replies from a queue. */
export interface FakeReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface RecordedXhr {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export function fakeXhrFactory(replies: FakeReply[] | ((req: RecordedXhr) => FakeReply)) {
  const requests: RecordedXhr[] = [];
  class FakeXhr {
    status = 0;
    responseText = '';
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private req: RecordedXhr = { method: '', url: '', headers: {}, body: null };
    private replyHeaders: Record<string, string> = {};
    open(method: string, url: string) {
      this.req = { method, url, headers: {}, body: null };
    }
    setRequestHeader(name: string, value: string) {
      this.req.headers[name.toLowerCase()] = value;
    }
    getResponseHeader(name: string): string | null {
      return this.replyHeaders[name.toLowerCase()] ?? null;
    }
    abort() {
      this.onabort?.();
    }
    send(body: unknown) {
      this.req.body = body;
      requests.push(this.req);
      const reply = typeof replies === 'function' ? replies(this.req) : replies.shift();
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent);
        setTimeout(() => {
          if (!reply) {
            this.onerror?.();
            return;
          }
          this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 } as ProgressEvent);
          this.status = reply.status;
          this.responseText = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
          this.replyHeaders = Object.fromEntries(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
          this.onload?.();
        }, 5);
      }, 5);
    }
  }
  return { Xhr: FakeXhr as unknown as typeof XMLHttpRequest, requests };
}
