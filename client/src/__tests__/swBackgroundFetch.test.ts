import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('sw-background-fetch Service Worker script', () => {
  let listeners: Record<string, (event: any) => void>;
  let mockBroadcastChannelPostMessage: ReturnType<typeof vi.fn>;
  let mockBroadcastChannelClose: ReturnType<typeof vi.fn>;
  let mockDir: any;
  let mockRoot: any;
  let mockStorage: any;
  let mockClients: any;
  let partHandle: any;

  beforeEach(() => {
    listeners = {};
    mockBroadcastChannelPostMessage = vi.fn();
    mockBroadcastChannelClose = vi.fn();

    class FakeBroadcastChannel {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      postMessage(msg: any) {
        mockBroadcastChannelPostMessage(msg);
      }
      close() {
        mockBroadcastChannelClose();
      }
    }

    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

    const partFileContent: Uint8Array[] = [];
    partHandle = {
      createWritable: vi.fn(async () => ({
        write: vi.fn(async (chunk) => {
          partFileContent.push(new Uint8Array(chunk));
        }),
        close: vi.fn(async () => {}),
      })),
      getFile: vi.fn(async () => ({
        size: 1024,
        stream: () => ({
          pipeTo: vi.fn(async () => {}),
        }),
        arrayBuffer: async () => new ArrayBuffer(1024),
      })),
      move: vi.fn(async () => {}),
    };

    const finalHandle: any = {
      createWritable: vi.fn(async () => ({
        write: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      })),
    };

    mockDir = {
      getFileHandle: vi.fn(async (name: string) => {
        if (name.endsWith('.part')) return partHandle;
        return finalHandle;
      }),
      removeEntry: vi.fn(async () => {}),
    };

    mockRoot = {
      getDirectoryHandle: vi.fn(async () => mockDir),
    };

    mockStorage = {
      getDirectory: vi.fn(async () => mockRoot),
    };

    mockClients = {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => {}),
    };

    const fakeSelf: any = {
      addEventListener: (type: string, listener: any) => {
        listeners[type] = listener;
      },
      clients: mockClients,
    };

    vi.stubGlobal('self', fakeSelf);
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: mockStorage,
    });

    // Execute the service worker script in the fake context
    const swScriptPath = path.resolve(__dirname, '../../public/sw-background-fetch.js');
    const swCode = fs.readFileSync(swScriptPath, 'utf8');
    // Run script in function scope with self and navigator available
    const runScript = new Function('self', 'navigator', 'BroadcastChannel', swCode);
    runScript(fakeSelf, navigator, FakeBroadcastChannel);
  });

  it('registers all 4 background fetch lifecycle events', () => {
    expect(listeners['backgroundfetchsuccess']).toBeDefined();
    expect(listeners['backgroundfetchfail']).toBeDefined();
    expect(listeners['backgroundfetchabort']).toBeDefined();
    expect(listeners['backgroundfetchclick']).toBeDefined();
  });

  it('handles backgroundfetchsuccess by streaming to OPFS and notifying clients on complete download', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': '1024',
      }),
      body: {
        pipeTo: vi.fn(async () => {}),
      },
    };

    const mockRecord = {
      responseReady: Promise.resolve(mockResponse),
    };

    const mockRegistration = {
      id: 'map-test-123',
      downloadTotal: 1024,
      matchAll: vi.fn(async () => [mockRecord]),
      updateUI: vi.fn(async () => {}),
    };

    let waitUntilPromise: Promise<void> | null = null;
    const event = {
      registration: mockRegistration,
      waitUntil: (p: Promise<void>) => {
        waitUntilPromise = p;
      },
    };

    listeners['backgroundfetchsuccess'](event);
    expect(waitUntilPromise).not.toBeNull();
    await waitUntilPromise;

    expect(mockRegistration.matchAll).toHaveBeenCalled();
    expect(mockStorage.getDirectory).toHaveBeenCalled();
    expect(mockDir.getFileHandle).toHaveBeenCalledWith('test-123.pmtiles.part', { create: true });
    expect(mockResponse.body.pipeTo).toHaveBeenCalled();
    expect(mockRegistration.updateUI).toHaveBeenCalledWith({ title: 'Map downloaded' });
    expect(mockBroadcastChannelPostMessage).toHaveBeenCalledWith({
      type: 'bg-fetch-success',
      mapId: 'test-123',
      totalBytes: 1024,
    });
  });

  it('handles backgroundfetchsuccess by emitting bg-fetch-partial and preserving .part if download was truncated', async () => {
    partHandle.getFile = vi.fn(async () => ({
      size: 500,
      stream: () => ({ pipeTo: vi.fn(async () => {}) }),
      arrayBuffer: async () => new ArrayBuffer(500),
    }));

    const mockResponse = {
      ok: true,
      status: 206,
      headers: new Headers({
        'content-range': 'bytes 0-499/5000',
        'x-extract-bytes': '5000',
      }),
      body: {
        pipeTo: vi.fn(async () => {}),
      },
    };

    const mockRecord = {
      responseReady: Promise.resolve(mockResponse),
    };

    const mockRegistration = {
      id: 'map-trunc-1',
      downloadTotal: 5000,
      matchAll: vi.fn(async () => [mockRecord]),
      updateUI: vi.fn(async () => {}),
    };

    let waitUntilPromise: Promise<void> | null = null;
    const event = {
      registration: mockRegistration,
      waitUntil: (p: Promise<void>) => {
        waitUntilPromise = p;
      },
    };

    listeners['backgroundfetchsuccess'](event);
    await waitUntilPromise;

    // Should NOT have moved or renamed to final .pmtiles
    expect(partHandle.move).not.toHaveBeenCalled();
    expect(mockRegistration.updateUI).toHaveBeenCalledWith({ title: 'Map download paused' });
    expect(mockBroadcastChannelPostMessage).toHaveBeenCalledWith({
      type: 'bg-fetch-partial',
      mapId: 'trunc-1',
      receivedBytes: 500,
      totalBytes: 5000,
    });
  });

  it('handles backgroundfetchfail by preserving .part file and updating UI to paused', async () => {
    const mockRegistration = {
      id: 'map-fail-1',
      updateUI: vi.fn(async () => {}),
    };

    let waitUntilPromise: Promise<void> | null = null;
    const event = {
      registration: mockRegistration,
      waitUntil: (p: Promise<void>) => {
        waitUntilPromise = p;
      },
    };

    listeners['backgroundfetchfail'](event);
    await waitUntilPromise;

    // Should NOT remove the .part file on network failure!
    expect(mockDir.removeEntry).not.toHaveBeenCalledWith('fail-1.pmtiles.part');
    expect(mockRegistration.updateUI).toHaveBeenCalledWith({ title: 'Map download paused' });
    expect(mockBroadcastChannelPostMessage).toHaveBeenCalledWith({
      type: 'bg-fetch-fail',
      mapId: 'fail-1',
      error: 'Download paused',
    });
  });

  it('handles backgroundfetchabort by notifying clients', async () => {
    const mockRegistration = {
      id: 'map-abort-1',
    };

    let waitUntilPromise: Promise<void> | null = null;
    const event = {
      registration: mockRegistration,
      waitUntil: (p: Promise<void>) => {
        waitUntilPromise = p;
      },
    };

    listeners['backgroundfetchabort'](event);
    await waitUntilPromise;

    expect(mockBroadcastChannelPostMessage).toHaveBeenCalledWith({
      type: 'bg-fetch-abort',
      mapId: 'abort-1',
    });
  });

  it('handles backgroundfetchclick by focusing client or opening window', async () => {
    const mockClient = {
      url: 'https://example.com/maps/click-1',
      focus: vi.fn(async () => {}),
    };
    mockClients.matchAll.mockResolvedValue([mockClient]);

    const mockRegistration = {
      id: 'map-click-1',
    };

    let waitUntilPromise: Promise<void> | null = null;
    const event = {
      registration: mockRegistration,
      waitUntil: (p: Promise<void>) => {
        waitUntilPromise = p;
      },
    };

    listeners['backgroundfetchclick'](event);
    await waitUntilPromise;

    expect(mockClient.focus).toHaveBeenCalled();
    expect(mockClients.openWindow).not.toHaveBeenCalled();
  });
});
