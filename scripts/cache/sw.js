import {precacheAndRoute, cleanupOutdatedCaches} from 'workbox-precaching';
import {createPartialResponse} from 'workbox-range-requests';
import {MediaStore, parseRange} from './media-store.js';
import manifest from '../cache-manifest.json';

const root = new URL('./', self.location.href);
const mediaByPath = new Map(manifest.media.map(media => [new URL(media.url, root).pathname, media]));
const store = new MediaStore({name: `memoir-media-v1:${root.pathname}`, report: message => {
    self.clients.matchAll().then(clients => clients.forEach(client => client.postMessage(message)));
}});
precacheAndRoute(manifest.shell, {ignoreURLParametersMatching: [/^v$/, /^reader$/, /^flip$/]});
cleanupOutdatedCaches();
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
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
