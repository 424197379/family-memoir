import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {CHUNK_SIZE,digest} from '../scripts/cache/media-store.js';

test('old worker passthrough saves new media once; corrupt responses never become complete',async()=>{
    const data=Uint8Array.from({length:CHUNK_SIZE+37},(_,i)=>i%251);
    const media={url:'bibi-bookshelf/photo.new.jpg',bytes:data.length,sha256:await digest(data),chunks:[],type:'image/jpeg'};
    for(let p=0;p<data.length;p+=CHUNK_SIZE) media.chunks.push(await digest(data.slice(p,p+CHUNK_SIZE)));
    const bundle=await build({entryPoints:['scripts/cache/client.js'],bundle:true,write:false,format:'iife',plugins:[{name:'fixture',setup(b){
        b.onResolve({filter:/cache-media\.json$/},()=>({path:'fixture',namespace:'fixture'}));
        b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:JSON.stringify([media]),loader:'json'}));
    }}]});
    async function client(name,responseBytes) {
        let requests=0;
        const origin='https://example.com/'+name+'/';
        const window={indexedDB,crypto,fetch:()=>{},AbortController,ReadableStream,dispatchEvent:()=>{},addEventListener:()=>{}};
        vm.runInNewContext(bundle.outputFiles[0].text,{window,document:{currentScript:{src:origin+'bibi/memoir-cache.js',dataset:{}},documentElement:{id:'bibi'}},location:{href:origin},navigator:{serviceWorker:{controller:{}}},indexedDB,crypto,URL,Blob,DOMException,Event,AbortController,ReadableStream,setTimeout,clearTimeout,fetch:async()=>{requests++;return new Response(responseBytes);}});
        return {api:window.MemoirCache,url:origin+media.url,requests:()=>requests};
    }
    const good=await client('upgrade-valid',data);
    const result=await good.api.download(good.url,()=>{});
    assert.equal(result.saved,true);
    assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),data);
    assert.equal((await good.api.download(good.url,()=>{})).saved,true);
    assert.equal(good.requests(),1,'revisit should not fetch again even with an old worker');
    const corrupted=data.slice();corrupted[CHUNK_SIZE]=255;
    const bad=await client('upgrade-corrupt',corrupted);
    await assert.rejects(bad.api.download(bad.url,()=>{}),/CONTENT_CHANGED/);
    const status=await bad.api.status(bad.url);
    assert.equal(status.complete,false);
    assert.equal(status.saved,CHUNK_SIZE,'only the valid prefix may be retained');
});
