import test from 'node:test';
import assert from 'node:assert/strict';
import {freshPage, readerAcknowledges} from '../scripts/cache/navigation.js';

test('same URL revalidates and returns the new page instead of the old cache', async () => {
    let saved;
    const result = await freshPage('https://example.test/bibi/', {
        fetcher: async (url,options) => {assert.equal(options.cache,'no-cache'); return new Response('new');},
        cached: async () => new Response('old'), save: async response => {saved = await response.text();}
    });
    assert.equal(await result.text(),'new'); assert.equal(saved,'new');
});
test('offline or HTTP failure preserves the last usable reader', async () => {
    for (const fetcher of [async () => {throw Error('offline');}, async () => new Response('bad',{status:503})]) {
        const result = await freshPage('url',{fetcher,cached:async () => new Response('saved'),save:async () => assert.fail('must not overwrite')});
        assert.equal(await result.text(),'saved');
    }
});
test('hung connection times out to local reader; no cache reports a real failure', async () => {
    const fetcher = (_, {signal}) => new Promise((resolve,reject) => signal.addEventListener('abort',()=>reject(Error('timeout'))));
    const options = {fetcher,timeout:10,cached:async () => new Response('saved'),save:async () => {}};
    assert.equal(await (await freshPage('url',options)).text(),'saved');
    await assert.rejects(freshPage('url',{...options,cached:async () => undefined}),/timeout/);
});
test('storage failure does not prevent online reading', async () => {
    const result = await freshPage('url',{fetcher:async () => new Response('new'),cached:async () => undefined,save:async () => {throw Error('quota');}});
    assert.equal(await result.text(),'new');
});
test('a stalled HTML body falls back without replacing the saved page', async () => {
    const fetcher = async (_, {signal}) => new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('<html>partial'));
        signal.addEventListener('abort',()=>controller.error(Error('body timeout')));
    }}));
    const result = await freshPage('url',{fetcher,timeout:10,cached:async () => new Response('complete saved page'),save:async () => assert.fail('partial page must not be saved')});
    assert.equal(await result.text(),'complete saved page');
});
test('current reader acknowledges update; legacy stalled reader does not', async () => {
    const current = {postMessage(message,ports) {assert.equal(message.type,'MEMOIR_READER_PROBE'); ports[0].postMessage({type:'MEMOIR_READER_READY'}); ports[0].close();}};
    assert.equal(await readerAcknowledges(current,{timeout:100}),true);
    const legacy = {postMessage(message,ports) {ports[0].close();}};
    assert.equal(await readerAcknowledges(legacy,{timeout:10}),false);
});
