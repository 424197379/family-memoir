import {MediaStore} from './media-store.js';
import media from '../cache-media.json';
const root = new URL('../', document.currentScript.src);
const useWorker = document.currentScript.dataset.serviceWorker !== 'off' && !!window.ReadableStream;
const catalog = new Map(media.map(item => [new URL(item.url, root).pathname, item]));
const supported = !!(window.indexedDB && window.crypto?.subtle && window.fetch && window.AbortController);
const store = supported ? new MediaStore({name: `memoir-media-v1:${root.pathname}`}) : null;
function itemFor(url) {
    const item = catalog.get(new URL(url, location.href).pathname);
    if (!item) throw new Error('UNKNOWN_MEDIA');
    return item;
}
async function status(url) {
    const item = itemFor(url);
    return store ? store.status(item) : {saved: 0, total: item.bytes, complete: false, available: false};
}
async function download(url, progress, signal) {
    const item = itemFor(url);
    if (!store) throw new Error('CACHE_UNAVAILABLE');
    const state = await store.status(item);
    progress({...state, loaded: 0, source: state.complete ? 'local' : state.saved ? 'resume' : 'network'});
    // Cross-origin media uses the explicit IndexedDB path; our worker cannot
    // intercept that origin and would otherwise report an uncached download.
    if (useWorker && navigator.serviceWorker?.controller && new URL(url, location.href).origin === root.origin) {
        const response = await fetch(versioned(url), {signal});
        if (!response.ok) throw new Error('HTTP_' + response.status);
        const reader = response.body.getReader(); const parts = []; let loaded = 0;
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            parts.push(value); loaded += value.byteLength;
            progress({...state, loaded, source: state.complete ? 'local' : state.saved ? 'resume' : 'network'});
        }
        if (loaded !== item.bytes) throw new Error('INCOMPLETE_FILE');
        const current = await store.status(item);
        return {blob: new Blob(parts, {type: item.type}), saved: current.complete, available: current.available};
    }
    const source = new URL(url, location.href); source.searchParams.set('v', item.sha256);
    source.searchParams.set('memoir-chunk', '1');
    const chunks = []; let loaded = 0;
    for (let i = 0; i < item.chunks.length; i++) {
        if (signal?.aborted) throw new DOMException('Paused', 'AbortError');
        const data = await store.chunk(item, i, source.href);
        if (signal?.aborted) throw new DOMException('Paused', 'AbortError');
        chunks.push(data); loaded += data.byteLength;
        progress({...state, loaded, source: state.complete ? 'local' : state.saved ? 'resume' : 'network'});
    }
    const current = await store.status(item);
    return {blob: new Blob(chunks, {type: item.type}), saved: current.complete, available: current.available};
}
function versioned(url) {
    const result = new URL(url, location.href); result.searchParams.set('v', itemFor(url).sha256); return result.href;
}
window.MemoirCache = {supported, status, download, versioned};
window.dispatchEvent(new Event('memoir-cache-ready'));

// Optional enhancement: media persistence above does not depend on service workers.
if (useWorker && 'serviceWorker' in navigator) {
    const register = () => {
    navigator.serviceWorker.register(new URL('sw.js', root), {scope: root.pathname, updateViaCache: 'none'}).then(registration => {
        document.getElementById('memoir-update')?.remove();
        registration.waiting?.postMessage({type:'SKIP_WAITING'});
        // Check when opening, independently of the browser's periodic SW check.
        registration.update().catch(() => { /* Offline: keep the installed reader. */ });
    }).catch(() => { /* WeChat versions without SW still use the IndexedDB download path. */ });
    };
    // Precache fetches must never compete with the flip reader's first chapter load.
    if (document.documentElement.id === 'bibi' && !window.memoirOpened) {
        window.addEventListener('memoir-opened', () => setTimeout(register, 3000), {once:true});
    } else setTimeout(register, 3000);
}
