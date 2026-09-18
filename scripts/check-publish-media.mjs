// 云端只校验已准备的发布副本，不读取家庭原件，也不兜底重新压缩。
import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originals = 'docs/bibi-bookshelf/memoir/OEBPS/media/';
const digest = data => createHash('sha256').update(data).digest('hex');

export async function validatePrepared(read, names) {
    const manifest = JSON.parse(await read('web-media/manifest.json'));
    assert.equal(manifest.version, 1, 'Unsupported media manifest');
    assert(Array.isArray(manifest.items) && manifest.items.length, 'Run npm run media:prepare locally before committing');
    const files = new Set(), sources = new Set();
    for (const item of manifest.items) {
        assert(typeof item.file==='string' && /^[\w.-]+$/.test(item.file) && path.basename(item.file)===item.file, 'Unsafe derivative name');
        assert(typeof item.source==='string' && /^[\w.-]+$/.test(item.source), 'Unsafe original name');
        assert(!files.has(item.file) && !sources.has(item.source), 'Duplicate media mapping');
        assert(/^[a-f0-9]{64}$/.test(item.sha256) && /^[a-f0-9]{64}$/.test(item.sourceSha256), 'Invalid media checksum');
        assert(item.file.includes('.'+item.sha256.slice(0,16)+'.'), 'Only content-addressed prepared media can be published');
        assert(['image/jpeg','image/png','video/mp4'].includes(item.type), 'Unprepared media type');
        files.add(item.file); sources.add(item.source);
        const data = await read('web-media/'+item.file);
        assert.equal(data.length, item.bytes, 'Prepared media size mismatch: '+item.file);
        assert.equal(digest(data), item.sha256, 'Prepared media checksum mismatch: '+item.file);
        if (item.type==='video/mp4') assert(item.bytes<=50*1024*1024, 'Video exceeds 50 MiB: '+item.file);
    }
    // 禁止把原文件或旧压缩缓存混进发布清单。
    for (const name of names) {
        assert(!name.startsWith(originals), 'Original media must remain local: '+name);
        if (name.startsWith('web-media/')) assert(name==='web-media/manifest.json' || files.has(name.slice(10)), 'Unlisted publication media: '+name);
    }
    return manifest;
}

export async function readPreparedMedia(root=here) {
    const names = (await readdir(path.join(root,'web-media'))).map(name=>'web-media/'+name);
    return validatePrepared(name=>readFile(path.join(root,name)), names);
}

export async function verifyGitMedia(ref, root=here) {
    const git = args=>exec('git',args,{cwd:root,encoding:'buffer',maxBuffer:128*1024*1024});
    const names = (await git(['ls-tree','-r','--name-only','-z',ref])).stdout.toString().split('\0').filter(Boolean);
    return validatePrepared(async name=>(await git(['show',ref+':'+name])).stdout, names);
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    let result;
    if (args[0]==='--index') {
        const {stdout} = await exec('git',['write-tree'],{cwd:here});
        result = await verifyGitMedia(stdout.trim());
    } else if (args[0]==='--ref') {
        assert(args[1], 'Missing Git ref');
        result = await verifyGitMedia(args[1]);
    } else {
        assert(!args.length, 'Unknown check option');
        result = await readPreparedMedia();
    }
    console.log(`Prepared publication media verified: ${result.items.length} files, ${result.items.reduce((n,i)=>n+i.bytes,0)} bytes`);
}
