// Revalidate the stable reading URL; media remains in its hash-keyed store.
export async function freshPage(request, {fetcher = fetch, cached, save, timeout = 6000}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetcher(request, {cache:'no-cache', signal:controller.signal});
        if (!response.ok) throw new Error('HTTP_'+response.status);
        // Headers alone are not a usable page. A truncated/stalled HTML body
        // must fall back too, rather than replacing the last readable copy.
        await response.clone().arrayBuffer();
        clearTimeout(timer);
        // Storage failure must not discard a successfully retrieved page.
        try { await save(response.clone()); } catch (_) { /* Online reading still works. */ }
        return response;
    } catch (error) {
        const fallback = await cached();
        if (fallback) return fallback;
        throw error;
    } finally { clearTimeout(timer); }
}

// Older pages cannot hear update messages and may be stuck before registration.
// New pages acknowledge this probe immediately, even before Bibi starts.
export function readerAcknowledges(client, {channel = () => new MessageChannel(), timeout = 1200} = {}) {
    return new Promise(resolve => {
        const ports = channel();
        let timer;
        const finish = value => { clearTimeout(timer); ports.port1.close(); resolve(value); };
        ports.port1.onmessage = event => finish(event.data?.type === 'MEMOIR_READER_READY');
        timer = setTimeout(() => finish(false), timeout);
        try { client.postMessage({type:'MEMOIR_READER_PROBE'}, [ports.port2]); }
        catch (_) { finish(false); }
    });
}
