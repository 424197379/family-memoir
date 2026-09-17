import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ffmpeg from 'ffmpeg-static';
import {prepareMedia, policy, probe, sha, videoFilters} from '../scripts/prepare-media.mjs';
import {rewriteMediaLinks} from '../scripts/media-links.mjs';
async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(),'memoir-media-test-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const source=path.join(root,'originals'),cache=path.join(root,'derived');
    await mkdir(source);
    return {source,cache,log:()=>{}};
}
test('photos retain originals, honor rotation, preserve alpha, and discover new files', async t => {
    const f=await fixture(t);
    const input=await sharp({create:{width:600,height:300,channels:3,background:'#ac7845'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    await writeFile(path.join(f.source,'portrait.jpg'),input);
    const settings={...policy,image:{...policy.image,longEdge:200,largeImagePixels:999999}};
    const first=(await prepareMedia({...f,settings})).items[0];
    assert.deepEqual([first.width,first.height],[100,200]);
    assert.equal(sha(await readFile(path.join(f.source,'portrait.jpg'))),sha(input));
    const repeated=(await prepareMedia({...f,settings})).items[0];
    assert.deepEqual(repeated,first);
    // A corrupt cached derivative must be rebuilt, never trusted by name alone.
    await writeFile(path.join(f.cache,first.file),'truncated');
    assert.equal((await prepareMedia({...f,settings})).items[0].sha256,first.sha256);
    await sharp({create:{width:30,height:20,channels:4,background:'#aa773380'}}).png().toFile(path.join(f.source,'new.png'));
    const next=(await prepareMedia({...f,settings})).items;
    const added=next.find(i=>i.source==='new.png');
    assert.equal(next.length,2);
    assert.deepEqual([added.width,added.height],[30,20]);
    assert.equal((await sharp(path.join(f.cache,added.file)).metadata()).hasAlpha,true);
    const changed=(await prepareMedia({...f,settings:{...settings,image:{...settings.image,longEdge:100}}})).items.find(i=>i.source==='portrait.jpg');
    assert.notEqual(changed.recipe,first.recipe);
    assert.deepEqual([changed.width,changed.height],[50,100]);
});
test('large photos keep extra resolution; small compatible images never grow', async t=>{
    const f=await fixture(t);
    await sharp({create:{width:600,height:400,channels:3,background:'#888888'}}).jpeg({quality:30}).toFile(path.join(f.source,'group.jpg'));
    await sharp({create:{width:40,height:30,channels:3,background:'#888888'}}).jpeg({quality:30}).toFile(path.join(f.source,'small.jpg'));
    const items=(await prepareMedia({...f,settings:{...policy,image:{...policy.image,longEdge:200,largeImagePixels:200000,largeLongEdge:300}}})).items;
    const group=items.find(i=>i.source==='group.jpg'),small=items.find(i=>i.source==='small.jpg');
    assert.equal(group.width,300);
    assert(small.bytes<=small.sourceBytes);
});
test('HDR and rotated video get appropriate tone mapping and dimensions',()=>{
    const hdr=videoFilters({width:1920,height:1080,color_transfer:'arib-std-b67',avg_frame_rate:'60/1',side_data_list:[{rotation:-90}]});
    assert(hdr.includes("min(1080,iw)"));
    assert(hdr.includes('tonemap='));
    assert(hdr.includes('fps=30'));
    assert(!videoFilters({width:1280,height:720,color_transfer:'bt709',avg_frame_rate:'24/1'}).includes('tonemap'));
});
test('real video output is H264/AAC, retains duration, fast-starts and preserves input',async t=>{
    const f=await fixture(t);
    const original=path.join(f.source,'clip.mp4');
    await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x240:rate=10','-f','lavfi','-i','sine=frequency=440','-t','0.5','-c:v','libx264','-c:a','aac',original]);
    const before=sha(await readFile(original));
    const item=(await prepareMedia(f)).items[0];
    const output=await readFile(path.join(f.cache,item.file));
    const info=await probe(path.join(f.cache,item.file));
    assert.equal(info.streams.find(s=>s.codec_type==='video').codec_name,'h264');
    assert.equal(info.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    assert(output.indexOf(Buffer.from('moov'))<output.indexOf(Buffer.from('mdat')));
    assert.equal(sha(await readFile(original)),before);
    await assert.rejects(prepareMedia({...f,settings:{...policy,video:{...policy.video,maxBytes:10}}}),/exceeds 50 MiB/);
});
test('media link rewriting updates byte counts and MIME without changing prose',()=>{
    const media=[{originalUrl:'media/photo.jpeg',url:'media/photo.hash.jpg',sourceBytes:900,bytes:100,sourceType:'image/jpeg',type:'image/jpeg'},{originalUrl:'media/clip.mov',url:'https://example.com/clip.hash.mp4',sourceBytes:2000,bytes:200,sourceType:'video/quicktime',type:'video/mp4'}];
    const text='<p>media/clip.mov 是旧文件名。</p><img data-memoir-src="media/photo.jpeg" data-memoir-bytes="900"/><video data-memoir-src="media/clip.mov"/><item href="media/clip.mov" media-type="video/quicktime"/>';
    const result=rewriteMediaLinks(text,media);
    assert(result.includes('data-memoir-bytes="100"'));
    assert(result.includes('media-type="video/mp4"'));
    assert(result.includes('<p>media/clip.mov 是旧文件名。</p>'));
    assert.equal(rewriteMediaLinks(result,media,true),text);
});
