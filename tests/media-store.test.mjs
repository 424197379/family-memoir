import 'fake-indexeddb/auto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MediaStore, CHUNK_SIZE, digest, parseRange} from '../scripts/cache/media-store.js';
const bytes = Uint8Array.from({length: CHUNK_SIZE * 2 + 37}, (_, i) => i % 251);
async function fixture(data = bytes) {
    const chunks = [];
    for (let i = 0; i < data.length; i += CHUNK_SIZE) chunks.push(await digest(data.slice(i, i + CHUNK_SIZE)));
    return {bytes: data.length, sha256: await digest(data), chunks, type: 'application/octet-stream'};
}
function server(data, calls, mode = 'range') {
    return async (_, options) => {
        calls.push(options.headers.Range);
        const [a, b] = parseRange(options.headers.Range, data.length);
        if (mode === 'full') return new Response(data);
        return new Response(data.slice(a, b + 1), {status: 206, headers: {'Content-Range': `bytes ${a}-${b}/${data.length}`}});
    };
}
test('restart resumes saved chunks; complete revisit sends zero media requests', async () => {
    const media = await fixture(), calls = [], name = 'resume';
    const first = new MediaStore({name, fetcher: server(bytes, calls)});
    await first.chunk(media, 0, '/photo');
    assert.equal((await first.status(media)).saved, CHUNK_SIZE);
    const second = new MediaStore({name, fetcher: server(bytes, calls)});
    const output = await new Response(second.stream(media, '/photo', 0, bytes.length - 1)).arrayBuffer();
    assert.deepEqual(new Uint8Array(output), bytes);
    assert.deepEqual(calls, ['bytes=0-262143','bytes=262144-524287','bytes=524288-524324']);
    const again = new MediaStore({name, fetcher: () => { throw Error('must not download'); }});
    assert.equal((await again.status(media)).complete, true);
    assert.deepEqual(new Uint8Array(await (await again.blob(media)).arrayBuffer()), bytes);
});
test('broken transfer preserves earlier chunk and retries the incomplete range', async () => {
    const media = await fixture(), calls = []; let fail = true;
    const normal = server(bytes, calls);
    const store = new MediaStore({name: 'broken', fetcher: async (url, opt) => {
        if (opt.headers.Range.startsWith('bytes=262144') && fail) {
            fail = false; calls.push(opt.headers.Range);
            return new Response(new Uint8Array(10), {status: 206, headers: {'Content-Range': 'bytes 262144-524287/524325'}});
        }
        return normal(url, opt);
    }});
    await assert.rejects(new Response(store.stream(media, '/x', 0, bytes.length - 1)).arrayBuffer(), /INCOMPLETE_CHUNK/);
    assert.equal((await store.status(media)).saved, CHUNK_SIZE);
    await new Response(store.stream(media, '/x', 0, bytes.length - 1)).arrayBuffer();
    assert.equal(calls.filter(x => x === 'bytes=0-262143').length, 1);
    assert.equal((await store.status(media)).complete, true);
});
test('changed content and malformed range cannot poison persistent cache', async () => {
    const media = await fixture(), wrong = new Uint8Array(bytes.length), calls = [];
    const bad = new MediaStore({name: 'bad-hash', fetcher: server(wrong, calls)});
    await assert.rejects(bad.chunk(media, 0, '/x'), /CONTENT_CHANGED/);
    assert.equal((await bad.status(media)).saved, 0);
    const invalid = new MediaStore({name: 'bad-range', fetcher: async () => new Response(bytes.slice(0, CHUNK_SIZE), {status: 206, headers: {'Content-Range': 'bytes 1-262144/524325'}})});
    await assert.rejects(invalid.chunk(media, 0, '/x'), /INVALID_CONTENT_RANGE/);
    const changed = await fixture(wrong);
    assert.equal((await bad.status(changed)).saved, 0);
});
test('HTTP 200 range fallback splits full file without appending at resume offset', async () => {
    const media = await fixture(), calls = [];
    const store = new MediaStore({name: 'ignores-range', fetcher: server(bytes, calls, 'full')});
    assert.deepEqual(new Uint8Array(await store.chunk(media, 1, '/x')), bytes.slice(CHUNK_SIZE, 2 * CHUNK_SIZE));
    assert.equal((await store.status(media)).complete, true);
    assert.equal(calls.length, 1);
});
test('concurrent reads share one missing chunk; video suffix and seek ranges are correct', async () => {
    const media = await fixture(), calls = [];
    const store = new MediaStore({name: 'concurrent', fetcher: server(bytes, calls)});
    await Promise.all([store.chunk(media, 0, '/x'), store.chunk(media, 0, '/x')]);
    assert.equal(calls.length, 1);
    for (const header of ['bytes=200000-300000','bytes=-17','bytes=524300-']) {
        const [start, end] = parseRange(header, media.bytes);
        const result = await new Response(store.stream(media, '/x', start, end)).arrayBuffer();
        assert.deepEqual(new Uint8Array(result), bytes.slice(start, end + 1));
    }
    for (const header of ['bytes=999999-','bytes=-0','bytes=8-2','bytes=0-1,3-5']) assert.throws(() => parseRange(header, media.bytes));
});
test('quota failure allows current read but never reports saved', async () => {
    const media = await fixture(), notices = [], calls = [];
    const store = new MediaStore({name: 'quota', fetcher: server(bytes, calls), report: n => notices.push(n)});
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); };
    try {
        assert.deepEqual(new Uint8Array(await store.chunk(media, 0, '/x')), bytes.slice(0, CHUNK_SIZE));
        const state = await store.status(media);
        assert.equal(state.saved, 0); assert.equal(state.available, false);
        assert.equal(notices.length, 1);
    } finally { IDBObjectStore.prototype.put = original; }
});
test('inactive connection times out and does not advance durable progress', async () => {
    const media = await fixture();
    const store = new MediaStore({name: 'timeout', timeout: 15, fetcher: (_, {signal}) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))))});
    await assert.rejects(store.chunk(media, 0, '/x'), {name: 'AbortError'});
    assert.equal((await store.status(media)).saved, 0);
});
test('webviews without response streaming can still save verified chunks', async () => {
    const media = await fixture();
    const store = new MediaStore({name: 'no-stream', fetcher: async () => ({status:206, headers:new Headers({'Content-Range':'bytes 0-262143/524325'}), body:null, arrayBuffer:async () => bytes.slice(0,CHUNK_SIZE).buffer})});
    await store.chunk(media, 0, '/x');
    assert.equal((await store.status(media)).saved, CHUNK_SIZE);
});
test('CORS-hidden range headers still require exact length and chunk hash', async () => {
    const media = await fixture();
    const cors = data => ({status:206, type:'cors', headers:new Headers(), body:null, arrayBuffer:async () => data.buffer});
    const good = new MediaStore({name:'cors-good', fetcher:async () => cors(bytes.slice(0,CHUNK_SIZE))});
    await good.chunk(media, 0, 'https://example.test/video');
    assert.equal((await good.status(media)).saved, CHUNK_SIZE);
    const bad = new MediaStore({name:'cors-wrong', fetcher:async () => cors(new Uint8Array(CHUNK_SIZE))});
    await assert.rejects(bad.chunk(media, 0, 'https://example.test/video'), /CONTENT_CHANGED/);
    assert.equal((await bad.status(media)).saved, 0);
    const short = new MediaStore({name:'cors-short', fetcher:async () => cors(new Uint8Array(12))});
    await assert.rejects(short.chunk(media, 0, 'https://example.test/video'), /INCOMPLETE_CHUNK/);
    assert.equal((await short.status(media)).saved, 0);
});
