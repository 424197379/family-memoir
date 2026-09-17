// Build an isolated Pages upload from the already-approved publication.
// Does not rebuild the manuscript, publish, or modify the GitHub checkout.
import {readFile, writeFile, readdir, cp, mkdir, stat, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {packReader} from './pack-reader.mjs';
import {prepareMedia} from './prepare-media.mjs';
import {rewriteMediaLinks} from './media-links.mjs';
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(here, 'docs');
const target = process.argv[2] || 'cloudflare';
assert(['cloudflare', 'github'].includes(target), 'Unknown hosting target: '+target);
const cloudflare = target === 'cloudflare';
const output = path.join(here, target+'-dist');
const hash = data => createHash('sha256').update(data).digest('hex');
const github = 'https://424197379.github.io/family-memoir/';
const prepared = await prepareMedia();
// This directory is disposable generated output, never a source or original.
await rm(output, {recursive:true, force:true});
await mkdir(output);
await cp(source, output, {recursive:true});
const media = [];
const replacements = [];
for (const item of prepared.items) {
    const relative = 'bibi-bookshelf/memoir/OEBPS/media/' + item.file;
    const originalRelative = 'bibi-bookshelf/memoir/OEBPS/media/' + item.source;
    assert.equal(hash(await readFile(path.join(source,originalRelative))),item.sourceSha256,'Original changed during build');
    const data = await readFile(path.join(here,'web-media',item.file));
    assert.equal(hash(data),item.sha256,'Derivative checksum mismatch');
    const video = item.type.startsWith('video/');
    if (video && data.length > 50*1024*1024) throw Error('Video exceeds 50 MiB: '+relative);
    const chunks = [];
    for (let i=0; i<data.length; i+=262144) chunks.push(hash(data.subarray(i,i+262144)));
    const types = {'.mov':'video/quicktime','.mp4':'video/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
    media.push({url:video && cloudflare ? github+relative : relative, sha256:item.sha256, bytes:data.length, chunks, type:item.type});
    replacements.push({...item,originalUrl:'media/'+item.source,url:video && cloudflare?github+relative:'media/'+item.file,sourceType:types[path.extname(item.source).toLowerCase()]});
    // Originals remain at their existing GitHub URLs for old cached readers.
    // New readers request only derivatives; Cloudflare never hosts the originals.
    if (cloudflare) await rm(path.join(output,originalRelative));
    if (!video || !cloudflare) await cp(path.join(here,'web-media',item.file),path.join(output,relative));
}
const bookDir = path.join(output,'bibi-bookshelf/memoir/OEBPS');
for (const name of await readdir(bookDir)) {
    if (!/\.(xhtml|opf)$/.test(name)) continue;
    const file = path.join(bookDir,name);
    await writeFile(file,rewriteMediaLinks(await readFile(file,'utf8'),replacements));
}
// Both hosts and the historical scrolling URL open the same flip-book.
const redirect = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>姥姥的回忆录</title><meta http-equiv="refresh" content="0;url=./bibi/"><a href="./bibi/">打开回忆录</a></html>';
await writeFile(path.join(output,'index.html'), redirect);
await writeFile(path.join(output,'read.html'), redirect);
const entry = path.join(output,'bibi/index.html');
let html = await readFile(entry,'utf8');
html = html.replace(/\s*<script>\s*\/\/ Share links[\s\S]*?<\/script>/, '');
html = html.replace(/<a\b[^>]*href="\.\.\/read\.html[^>]*>[\s\S]*?<\/a>/g,'');
await writeFile(entry,html);
const extensionFile = path.join(output,'bibi/extensions/memoir-loading.js');
const extension = await readFile(extensionFile,'utf8');
await writeFile(extensionFile, extension.replace('navigator.serviceWorker?.controller && !button.hidden', 'new URL(url).origin === location.origin && navigator.serviceWorker?.controller && !button.hidden').replaceAll('打开原视频','单独打开视频').replaceAll('加载原图','加载照片'));
const plugin = manifest => ({name:'pages-catalog',setup(builder) {
    builder.onResolve({filter:/cache-(media|manifest)\.json$/}, args=>({path:args.path,namespace:'generated-catalog'}));
    builder.onLoad({filter:/cache-media\.json$/,namespace:'generated-catalog'},()=>({contents:JSON.stringify(media),loader:'json'}));
    builder.onLoad({filter:/cache-manifest\.json$/,namespace:'generated-catalog'},()=>({contents:JSON.stringify(manifest),loader:'json'}));
}});
await build({absWorkingDir:here,entryPoints:['scripts/cache/client.js'],bundle:true,minify:true,outfile:path.join(output,'bibi/memoir-cache.js'),format:'iife',target:['es2017'],plugins:[plugin({})]});
const cacheScript = 'memoir-cache.' + hash(await readFile(path.join(output,'bibi/memoir-cache.js'))).slice(0,16) + '.js';
await cp(path.join(output,'bibi/memoir-cache.js'),path.join(output,'bibi',cacheScript));
const packed = await packReader(output, cacheScript);
if (cloudflare) await writeFile(path.join(output,'_headers'), '/\n  Cache-Control: no-cache\n/sw.js\n  Cache-Control: no-cache\n/*.html\n  Cache-Control: no-cache\n/bibi/\n  Cache-Control: no-cache\n/bibi/memoir-cache.js\n  Cache-Control: no-cache\n');
const shell = [], files = [];
async function walk(dir='') {
    for (const entry of await readdir(path.join(output,dir),{withFileTypes:true})) {
        const relative = path.posix.join(dir,entry.name);
        if (entry.isDirectory()) {await walk(relative); continue;}
        const size = (await stat(path.join(output,relative))).size;
        if (cloudflare && size>25*1024*1024) throw Error('Cloudflare Pages 25 MiB limit: '+relative);
        if (/\.(zip|epub)$/i.test(relative) || (cloudflare && /\.(mov|mp4)$/i.test(relative))) throw Error('Unexpected large archive or video: '+relative);
        files.push({path:relative,bytes:size});
        // The reader HTML already embeds the core, chapters, font and styles.
        // Do not make an upgrade wait for dozens of redundant resources.
        if (['index.html','bibi/index.html','bibi/'+cacheScript].includes(relative)) shell.push({url:relative,revision:hash(await readFile(path.join(output,relative)))});
    }
}
await walk();
await build({absWorkingDir:here,entryPoints:['scripts/cache/sw.js'],bundle:true,minify:true,outfile:path.join(output,'sw.js'),format:'iife',target:['es2020'],define:{'process.env.NODE_ENV':'"production"'},plugins:[plugin({media,shell})]});
// Reversing media attributes must recover the approved prose byte for byte.
const chapters = await readdir(path.join(source,'bibi-bookshelf/memoir/OEBPS'));
for (const name of chapters.filter(name=>/^chapter-.*\.xhtml$/.test(name))) {
    const relative = 'bibi-bookshelf/memoir/OEBPS/'+name;
    let actual = await readFile(path.join(output,relative),'utf8');
    actual = rewriteMediaLinks(actual,replacements,true);
    assert.equal(actual,await readFile(path.join(source,relative),'utf8'),'Chapter changed: '+name);
}
for (const item of media.filter(item=>!item.url.startsWith(github))) {
    assert.equal(hash(await readFile(path.join(output,item.url))),item.sha256,'Media changed: '+item.url);
}
assert(!html.includes('../read.html'), 'Flip reader must not redirect to scrolling text');
assert(files.length<=20000, 'Pages file count exceeded');
// Build metadata is not included in the public site.
console.log(JSON.stringify({output,...packed,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0),externalVideos:media.filter(m=>m.url.startsWith('https:')).map(m=>m.url)},null,2));
