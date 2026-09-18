// 本机提交前生成压缩副本；只清理旧清单中已被替换的派生缓存，不触碰原件。
import {readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMedia} from './prepare-media.mjs';
const cache = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web-media');
let previous = {items:[]};
try { previous = JSON.parse(await readFile(path.join(cache,'manifest.json'),'utf8')); }
catch (error) { if (error.code!=='ENOENT') throw error; }
const result = await prepareMedia();
const keep = new Set(result.items.map(item=>item.file));
for (const item of previous.items) {
    if (!keep.has(item.file) && /^[\w.-]+\.[a-f0-9]{16}\.(jpg|png|mp4)$/.test(item.file)) await rm(path.join(cache,item.file),{force:true});
}
console.log(JSON.stringify({files:result.items.length,before:result.items.reduce((n,i)=>n+i.sourceBytes,0),after:result.items.reduce((n,i)=>n+i.bytes,0)},null,2));
