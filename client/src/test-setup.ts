import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

// vmThreads VM context does not inherit jsdom globals like ReadableStream
if (typeof ReadableStream === 'undefined') {
  (global as any).ReadableStream = NodeReadableStream;
}

// Mock fetch
global.fetch = vi.fn();

// Mock crypto.randomUUID
if (!window.crypto.randomUUID) {
  Object.defineProperty(window.crypto, 'randomUUID', {
    value: () => 'test-uuid-' + Math.random().toString(36).substring(2),
    writable: true,
  });
}

// Polyfill Blob.prototype.stream / File.prototype.stream for jsdom environment if needed
if (typeof Blob !== 'undefined' && typeof Blob.prototype.stream !== 'function') {
  Blob.prototype.stream = function () {
    return new ReadableStream({
      start: async (controller) => {
        const buf = await this.arrayBuffer();
        controller.enqueue(new Uint8Array(buf));
        controller.close();
      },
    });
  };
}
if (typeof File !== 'undefined' && typeof File.prototype.stream !== 'function') {
  File.prototype.stream = Blob.prototype.stream;
}

// Polyfill File for Node environment if needed
if (typeof File === 'undefined') {
  global.File = class File extends Blob {
    name: string;
    lastModified: number;

    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag) {
      super(fileBits, options);
      this.name = fileName;
      this.lastModified = options?.lastModified || Date.now();
    }
  } as any;
}

// Polyfill IDBKeyRange for Node/jsdom environment if needed
if (typeof IDBKeyRange === 'undefined') {
  (global as any).IDBKeyRange = {
    only: (val: any) => val,
    lowerBound: (val: any) => val,
    upperBound: (val: any) => val,
    bound: (lower: any, upper: any) => ({ lower, upper }),
  };
}

// Polyfill Element.prototype.scrollTo for jsdom environment if needed
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = function (options?: any) {
    if (typeof options === 'object' && options !== null && 'top' in options) {
      this.scrollTop = options.top;
    }
  };
}

