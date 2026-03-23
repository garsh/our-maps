// Mock crypto.randomUUID
if (!window.crypto.randomUUID) {
  Object.defineProperty(window.crypto, 'randomUUID', {
    value: () => 'test-uuid-' + Math.random().toString(36).substring(2),
    writable: true,
  });
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
