import {precacheAndRoute, cleanupOutdatedCaches, matchPrecache} from 'workbox-precaching';
import {registerRoute} from 'workbox-routing';
import {createPartialResponse} from 'workbox-range-requests';
import {MediaStore, parseRange} from './media-store.js';
import {freshPage, readerAcknowledges} from './navigation.js';
import manifest from '../cache-manifest.json';

const root = new URL('./', self.location.href);
const pageCache = 'memoir-pages-' + manifest.shell.find(item => item.url === 'bibi/index.html').revision;
const mediaByPath = new Map(manifest.media.map(media => [new URL(media.url, root).pathname, media]));
const store = new MediaStore({name: `memoir-media-v1:${root.pathname}`, report: message => {
    self.clients.matchAll().then(clients => clients.forEach(client => client.postMessage(message)));
}});
const pages = new Set(['', 'index.html', 'bibi/', 'bibi/index.html'].map(p => new URL(p,root).pathname));
// Register before the Workbox precache route: navigation must not be cache-first.
registerRoute(({request,url}) => request.mode === 'navigate' && url.origin === root.origin && pages.has(url.pathname),
    async ({request,url}) => {
        const key = new URL(url.pathname.endsWith('/bibi/') || url.pathname.endsWith('/bibi/index.html') ? 'bibi/index.html' : 'index.html',root).href;
        const cache = await caches.open(pageCache).catch(() => null);
        return freshPage(request, {cached:async () => (await cache?.match(key)) || matchPrecache(key), save:response => cache?.put(key,response)});
    });
precacheAndRoute(manifest.shell, {ignoreURLParametersMatching: [/^v$/, /^reader$/, /^flip$/]});
cleanupOutdatedCaches();
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
    await self.clients.claim();
    await Promise.all((await caches.keys()).filter(name => name.startsWith('memoir-pages-') && name !== pageCache).map(name => caches.delete(name)));
    const clients = await self.clients.matchAll({type:'window'});
    await Promise.all(clients.map(async client => {
        const url = new URL(client.url);
        if (url.origin !== root.origin || !pages.has(url.pathname)) return;
        if (!await readerAcknowledges(client)) {
            // One-time migration of legacy pages, including the stalled loader.
            // Acknowledging readers keep their current page while reading.
            // Do not await navigation inside activate: its fetch waits for
            // activation to finish and would otherwise deadlock this worker.
            client.navigate(client.url).catch(() => { /* Next open uses freshPage. */ });
        }
    }));
})()));
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
    if (event.data?.type !== 'MEDIA_STATUS') return;
    const media = mediaByPath.get(new URL(event.data.url, root).pathname);
    if (!media) { event.ports[0]?.postMessage({error: 'UNKNOWN_MEDIA'}); return; }
    event.waitUntil(store.status(media).then(status => event.ports[0]?.postMessage(status)));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const media = mediaByPath.get(url.pathname);
    if (url.origin !== root.origin || !media || event.request.method !== 'GET' || url.searchParams.has('memoir-chunk')) return;
    // Old reader tabs must not silently receive a new file with the same logical ID.
    if (url.searchParams.get('v') !== media.sha256) return;
    event.respondWith((async () => {
        const range = event.request.headers.get('Range');
        let start, end;
        try { [start, end] = parseRange(range, media.bytes); }
        catch (_) { return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${media.bytes}`}}); }
        const status = await store.status(media);
        const headers = {'Content-Type': media.type, 'Accept-Ranges': 'bytes',
            'X-Memoir-Cache': status.complete ? 'local' : status.saved ? 'resume' : 'network',
            'X-Memoir-Saved': String(status.saved), 'Content-Length': String(end - start + 1)};
        if (status.complete) {
            try {
                const response = new Response(await store.blob(media), {headers: {...headers, 'Content-Length': String(media.bytes)}});
                return range ? createPartialResponse(event.request, response) : response;
            } catch (_) { /* Evicted between the status check and read; fetch verified chunks. */ }
        }
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${media.bytes}`;
        return new Response(store.stream(media, url.href, start, end), {status: range ? 206 : 200, headers});
    })());
});
