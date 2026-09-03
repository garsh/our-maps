import { describe, it, expect, beforeEach } from 'vitest';
import {
    extractExists,
    getExtractFile,
    getPartFileSize,
    getExtractResumeInfo,
    writeExtractMeta,
    writeExtractFromStream,
    removeExtract,
    removeAllExtracts,
    invalidateExtractCache,
} from '../extractStore';

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
                createWritable: async (opts?: { keepExistingData?: boolean }) => {
                    const existing = files.get(name) || new Uint8Array();
                    let data = opts?.keepExistingData ? Uint8Array.from(existing) : new Uint8Array();
                    let pos = 0;
                    let closed = false;
                    return {
                        seek: async (position: number) => { pos = position; },
                        write: async (input: BufferSource | string | { type?: string; position?: number; data?: BufferSource }) => {
                            if (input && typeof input === 'object' && 'type' in input && input.type === 'seek') {
                                pos = input.position || 0;
                                return;
                            }
                            const raw = input && typeof input === 'object' && 'data' in input ? input.data : input;
                            const bytes = typeof raw === 'string'
                                ? new TextEncoder().encode(raw)
                                : raw instanceof Uint8Array
                                    ? raw
                                    : new Uint8Array(raw as ArrayBuffer);
                            const end = pos + bytes.byteLength;
                            if (end > data.length) {
                                const next = new Uint8Array(end);
                                next.set(data);
                                data = next;
                            }
                            data.set(bytes, pos);
                            pos = end;
                        },
                        close: async () => {
                            if (closed) return;
                            closed = true;
                            files.set(name, data);
                        },
                        abort: async () => { closed = true; },
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
        expect(await getPartFileSize('mapx')).toBe(130);
    });

    it('stores extract total bytes in a sidecar so resume can show progress immediately', async () => {
        files = installOpfsMock({ extractDirExists: true });
        files.set('sized.pmtiles.part', new Uint8Array(80));
        await writeExtractMeta('sized', { totalBytes: 200 });
        expect(await getExtractResumeInfo('sized')).toEqual({ partBytes: 80, totalBytes: 200 });
        await removeExtract('sized');
        expect(await getExtractResumeInfo('sized')).toEqual({ partBytes: 0, totalBytes: 0 });
        expect(files.has('sized.pmtiles.part.meta')).toBe(false);
    });

    it('keeps a .part file when the stream fails so a later download can resume', async () => {
        const payload = new Uint8Array(200).map((_, i) => i);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload.subarray(0, 80));
            },
            pull(controller) {
                controller.error(new Error('network drop'));
            }
        });

        await expect(writeExtractFromStream('resume-me', stream)).rejects.toThrow('network drop');
        expect(files.has('resume-me.pmtiles.part')).toBe(true);
        expect(files.get('resume-me.pmtiles.part')!.length).toBe(80);
        expect(files.has('resume-me.pmtiles')).toBe(false);
        expect(await getPartFileSize('resume-me')).toBe(80);
        expect(await extractExists('resume-me')).toBe(false);
    });

    it('appends to an existing .part file from startOffset and finalizes', async () => {
        files = installOpfsMock({ extractDirExists: true });
        const payload = new Uint8Array(200).map((_, i) => i);
        files.set('resume-me.pmtiles.part', payload.subarray(0, 80));

        const progress: number[] = [];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload.subarray(80));
                controller.close();
            }
        });
        const result = await writeExtractFromStream('resume-me', stream, (n) => progress.push(n), { startOffset: 80 });
        expect(result.bytes).toBe(200);
        expect(progress[0]).toBe(80);
        expect(progress[progress.length - 1]).toBe(200);
        expect(files.has('resume-me.pmtiles')).toBe(true);
        expect(files.has('resume-me.pmtiles.part')).toBe(false);
        expect(Array.from(files.get('resume-me.pmtiles')!)).toEqual(Array.from(payload));
        expect(await extractExists('resume-me')).toBe(true);
    });

    it('checkpoints a long write so a later resume can append', async () => {
        const payload = new Uint8Array(200).map((_, i) => i);
        const failing = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload.subarray(0, 50));
                controller.enqueue(payload.subarray(50, 90));
            },
            pull(controller) {
                controller.error(new Error('dropped after checkpoint'));
            }
        });
        await expect(writeExtractFromStream('chk', failing, undefined, { checkpointBytes: 40 }))
            .rejects.toThrow('dropped after checkpoint');
        expect(await getPartFileSize('chk')).toBe(90);

        const resume = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(payload.subarray(90));
                controller.close();
            }
        });
        const result = await writeExtractFromStream('chk', resume, undefined, { startOffset: 90, checkpointBytes: 40 });
        expect(result.bytes).toBe(200);
        expect(Array.from(files.get('chk.pmtiles')!)).toEqual(Array.from(payload));
    });

    it('overwrites a stale .part file when startOffset is 0', async () => {
        files = installOpfsMock({ extractDirExists: true });
        files.set('fresh.pmtiles.part', new Uint8Array(80).fill(9));
        const payload = new Uint8Array(130).map((_, i) => i);
        const result = await writeExtractFromStream('fresh', new ReadableStream({
            start(c) { c.enqueue(payload); c.close(); }
        }), undefined, { startOffset: 0 });
        expect(result.bytes).toBe(130);
        expect(Array.from(files.get('fresh.pmtiles')!)).toEqual(Array.from(payload));
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
