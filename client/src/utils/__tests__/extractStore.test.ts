import { describe, it, expect, beforeEach } from 'vitest';
import {
    extractExists,
    getExtractFile,
    writeExtractFromStream,
    removeExtract,
    removeAllExtracts,
    invalidateExtractCache,
} from '../extractStore';

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

function notFound(): DOMException {
    return new DOMException(
        'A requested file or directory could not be found at the time an operation was processed.',
        'NotFoundError'
    );
}

function installOpfsMock(options?: { extractDirExists?: boolean }) {
    const files = new Map<string, Uint8Array>();
    let extractDirExists = options?.extractDirExists ?? false;
    const dir: any = {
        getFileHandle: async (name: string, opts?: { create?: boolean }) => {
            if (!files.has(name) && !opts?.create) {
                throw notFound();
            }
            if (!files.has(name) && opts?.create) {
                files.set(name, new Uint8Array());
            }
            return {
                getFile: async () => new File([files.get(name) || new Uint8Array()], name),
                createWritable: async () => {
                    const chunks: Uint8Array[] = [];
                    return {
                        write: async (data: BufferSource) => {
                            const bytes = data instanceof Uint8Array
                                ? data
                                : new Uint8Array(data as ArrayBuffer);
                            chunks.push(bytes);
                        },
                        close: async () => {
                            files.set(name, concatChunks(chunks));
                        },
                        abort: async () => {},
                    };
                },
                move: async (dest: string) => {
                    const data = files.get(name) || new Uint8Array();
                    files.set(dest, data);
                    files.delete(name);
                },
            };
        },
        removeEntry: async (name: string) => {
            files.delete(name);
        },
        entries: async function* () {
            for (const name of files.keys()) {
                yield [name, {}];
            }
        },
        _files: files,
    };

    const root: any = {
        getDirectoryHandle: async (name: string, opts?: { create?: boolean }) => {
            if (name !== 'offline-extracts') {
                if (!opts?.create) throw notFound();
            }
            if (!extractDirExists && !opts?.create) throw notFound();
            extractDirExists = true;
            return dir;
        },
        removeEntry: async (name: string) => {
            if (name === 'offline-extracts') {
                if (!extractDirExists) throw notFound();
                extractDirExists = false;
                files.clear();
                return;
            }
            throw notFound();
        },
    };

    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { getDirectory: async () => root },
    });

    return files;
}

describe('extractStore', () => {
    let files: Map<string, Uint8Array>;

    beforeEach(() => {
        invalidateExtractCache();
        files = installOpfsMock({ extractDirExists: false });
    });

    it('writes a streamed extract to a final .pmtiles file via a part file', async () => {
        const payload = new Uint8Array(200).map((_, i) => i);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload.subarray(0, 80));
                controller.enqueue(payload.subarray(80));
                controller.close();
            }
        });

        const progress: number[] = [];
        const result = await writeExtractFromStream('map 1', stream, (n) => progress.push(n));
        expect(result.bytes).toBe(200);
        expect(progress[progress.length - 1]).toBe(200);
        expect(files.has('map_1.pmtiles')).toBe(true);
        expect(files.has('map_1.pmtiles.part')).toBe(false);
        expect(files.get('map_1.pmtiles')!.length).toBe(200);
        expect(await extractExists('map 1')).toBe(true);

        const file = await getExtractFile('map 1');
        expect(file).not.toBeNull();
        expect(file!.size).toBe(200);
    });

    it('removes a single extract and all extracts', async () => {
        await writeExtractFromStream('a', new ReadableStream({
            start(c) { c.enqueue(new Uint8Array(130)); c.close(); }
        }));
        await writeExtractFromStream('b', new ReadableStream({
            start(c) { c.enqueue(new Uint8Array(130)); c.close(); }
        }));
        expect(await extractExists('a')).toBe(true);
        expect(await extractExists('b')).toBe(true);

        await removeExtract('a');
        expect(await extractExists('a')).toBe(false);
        expect(await extractExists('b')).toBe(true);

        await removeAllExtracts();
        expect(await extractExists('b')).toBe(false);
    });

    it('does not treat a .part file as a completed extract', async () => {
        files = installOpfsMock({ extractDirExists: true });
        files.set('mapx.pmtiles.part', new Uint8Array(130));
        expect(await getExtractFile('mapx')).toBeNull();
        expect(await extractExists('mapx')).toBe(false);
    });

    it('rejects a truncated extract file as missing', async () => {
        files = installOpfsMock({ extractDirExists: true });
        files.set('tiny.pmtiles', new Uint8Array(10));
        expect(await getExtractFile('tiny')).toBeNull();
    });

    it('caches missing extracts so later lookups skip OPFS', async () => {
        files = installOpfsMock({ extractDirExists: true });
        expect(await getExtractFile('gone')).toBeNull();
        delete (navigator as any).storage;
        expect(await getExtractFile('gone')).toBeNull();
        expect(await extractExists('gone')).toBe(false);
    });

    it('removeAllExtracts succeeds when no extract directory exists yet', async () => {
        await expect(removeAllExtracts()).resolves.toBeUndefined();
        expect(await extractExists('anything')).toBe(false);
    });

    it('removeExtract succeeds when no extract directory exists yet', async () => {
        await expect(removeExtract('old-idb-map')).resolves.toBeUndefined();
    });
});
