import {createStore, get, set, getMany} from 'idb-keyval';

export const CHUNK_SIZE = 256 * 1024;
export async function digest(data) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), n => n.toString(16).padStart(2, '0')).join('');
}

// A single HTTP byte range; invalid and multi-range requests are rejected explicitly.
export function parseRange(value, size) {
    if (!value) return [0, size - 1];
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match || (!match[1] && !match[2])) throw new Error('INVALID_RANGE');
    let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    let end = match[1] && match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (!match[1] && Number(match[2]) === 0)) throw new Error('INVALID_RANGE');
    return [start, Math.min(end, size - 1)];
}

export class MediaStore {
    constructor({name, fetcher = (...args) => fetch(...args), report = () => {}, timeout = 30000}) {
        this.store = createStore(name, 'chunks');
        this.fetcher = fetcher; this.report = report; this.timeout = timeout;
        this.pending = new Map(); this.storageFailed = false;
    }
    key(media, index) { return `${media.sha256}:${index}`; }
    async read(media, index) {
        try {
            const data = await get(this.key(media, index), this.store);
            return data?.byteLength === Math.min(CHUNK_SIZE, media.bytes - index * CHUNK_SIZE) ? data : null;
        } catch (_) { this.storageError(); return null; }
    }
    storageError() {
        if (!this.storageFailed) this.report({type: 'storage-unavailable'});
        this.storageFailed = true;
    }
    async status(media) {
        let chunks;
        try { chunks = await getMany(media.chunks.map((_, i) => this.key(media, i)), this.store); }
        catch (_) { this.storageError(); chunks = []; }
        const saved = chunks.reduce((sum, data, i) => sum + (data?.byteLength === Math.min(CHUNK_SIZE, media.bytes - i * CHUNK_SIZE) ? data.byteLength : 0), 0);
        return {saved, total: media.bytes, complete: saved === media.bytes, available: !this.storageFailed};
    }
    async chunk(media, index, url) {
        const key = this.key(media, index);
        const cached = await this.read(media, index);
        if (cached) return cached;
        if (this.pending.has(key)) return this.pending.get(key);
        const task = this.download(media, index, url);
        this.pending.set(key, task);
        try { return await task; } finally { this.pending.delete(key); }
    }
    async save(media, index, data) {
        // Only complete, hash-verified chunks can advance durable download progress.
        if (await digest(data) !== media.chunks[index]) throw new Error('CONTENT_CHANGED');
        if (!this.storageFailed) {
            try { await set(this.key(media, index), data, this.store); }
            catch (_) { this.storageError(); }
        }
        return data;
    }
    async download(media, index, url) {
        const start = index * CHUNK_SIZE, end = Math.min(media.bytes, start + CHUNK_SIZE) - 1;
        const controller = new AbortController();
        let timer;
        const heartbeat = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), this.timeout); };
        heartbeat();
        try {
            const response = await this.fetcher(url, {headers: {Range: `bytes=${start}-${end}`}, signal: controller.signal});
            if (response.status !== 206 && response.status !== 200) throw new Error(`HTTP_${response.status}`);
            const contentRange = response.headers.get('Content-Range');
            // CORS can hide Content-Range. Accept that case only for a CORS
            // response; exact byte length and the expected chunk SHA still gate saving.
            const hiddenRange = response.type === 'cors' && contentRange === null;
            if (response.status === 206 && !hiddenRange && contentRange !== `bytes ${start}-${end}/${media.bytes}`) throw new Error('INVALID_CONTENT_RANGE');
            // Servers which ignore Range must never append a full file at the resume offset.
            const limit = response.status === 200 ? media.bytes : end - start + 1;
            const parts = []; let size = 0;
            const reader = response.body?.getReader?.();
            if (!reader) {
                const data = await response.arrayBuffer();
                size = data.byteLength; parts.push(data);
            }
            while (reader) {
                const {done, value} = await reader.read();
                if (done) break;
                heartbeat(); size += value.byteLength;
                if (size > limit) { await reader.cancel(); throw new Error('INVALID_LENGTH'); }
                parts.push(value);
            }
            if (size !== limit) throw new Error('INCOMPLETE_CHUNK');
            const data = await new Blob(parts).arrayBuffer();
            if (response.status === 200) {
                if (await digest(data) !== media.sha256) throw new Error('CONTENT_CHANGED');
                for (let i = 0; i < media.chunks.length; i++) await this.save(media, i, data.slice(i * CHUNK_SIZE, Math.min(data.byteLength, (i + 1) * CHUNK_SIZE)));
                return data.slice(start, end + 1);
            }
            return await this.save(media, index, data);
        } finally { clearTimeout(timer); }
    }
    stream(media, url, start, end) {
        let index = Math.floor(start / CHUNK_SIZE), cancelled = false;
        const last = Math.floor(end / CHUNK_SIZE);
        return new ReadableStream({
            pull: async control => {
                try {
                    const current = index++;
                    const data = await this.chunk(media, current, url);
                    if (cancelled) return;
                    control.enqueue(new Uint8Array(data.slice(Math.max(0, start - current * CHUNK_SIZE), Math.min(data.byteLength, end - current * CHUNK_SIZE + 1))));
                    if (current === last) control.close();
                } catch (error) { if (!cancelled) control.error(error); }
            },
            // Let an in-flight chunk finish saving; never fetch the next chunk after cancellation.
            cancel: () => { cancelled = true; }
        }, {highWaterMark: 0});
    }
    async blob(media) {
        const chunks = await getMany(media.chunks.map((_, i) => this.key(media, i)), this.store);
        if (chunks.some((chunk, i) => chunk?.byteLength !== Math.min(CHUNK_SIZE, media.bytes - i * CHUNK_SIZE))) throw new Error('CACHE_MISS');
        return new Blob(chunks, {type: media.type});
    }
}
