import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {validatePrepared,readPreparedMedia,verifyGitMedia} from '../scripts/check-publish-media.mjs';
const data=Buffer.from('fixture-only'),hash=createHash('sha256').update(data).digest('hex');
const item={source:'photo.jpg',sourceSha256:hash,sourceBytes:data.length,file:`photo.${hash.slice(0,16)}.jpg`,sha256:hash,bytes:data.length,type:'image/jpeg'};
const manifest={version:1,items:[item]};
const read=async name=>name.endsWith('manifest.json')?Buffer.from(JSON.stringify(manifest)):data;
const names=['web-media/manifest.json','web-media/'+item.file];
test('cloud verification needs only prepared files, not original media',async t=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'memoir-prepared-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    await mkdir(path.join(root,'web-media'));
    await writeFile(path.join(root,'web-media/manifest.json'),JSON.stringify(manifest));
    await writeFile(path.join(root,'web-media',item.file),data);
    assert.deepEqual(await readPreparedMedia(root),manifest);
    await rm(path.join(root,'web-media',item.file));
    await assert.rejects(readPreparedMedia(root),/ENOENT/);
});
test('publication rejects originals and unlisted files rather than silently encoding',async()=>{
    await assert.rejects(validatePrepared(read,[...names,'docs/bibi-bookshelf/memoir/OEBPS/media/photo.jpg']),/Original media must remain local/);
    await assert.rejects(validatePrepared(read,[...names,'web-media/original.mov']),/Unlisted publication media/);
});
test('prepared-file checksum mismatch fails instead of publishing damaged media',async()=>{
    await assert.rejects(validatePrepared(name=>name.endsWith('manifest.json')?read(name):Buffer.alloc(data.length),names),/checksum mismatch/);
});
test('actual Git snapshot is checked even when the worktree looks corrected',async t=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'memoir-git-gate-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const git=async args=>(await promisify(execFile)('git',['-c','core.hooksPath=/dev/null',...args],{cwd:root})).stdout.trim();
    await git(['init','-q']);
    await mkdir(path.join(root,'web-media'));
    await writeFile(path.join(root,'web-media/manifest.json'),JSON.stringify(manifest));
    await writeFile(path.join(root,'web-media',item.file),data);
    await git(['add','.']);
    const valid=await git(['write-tree']);
    assert.deepEqual(await verifyGitMedia(valid,root),manifest);
    const original=path.join(root,'docs/bibi-bookshelf/memoir/OEBPS/media');
    await mkdir(original,{recursive:true});await writeFile(path.join(original,'photo.jpg'),'uncompressed');
    await git(['add','.']);const invalid=await git(['write-tree']);
    await rm(original,{recursive:true});
    await assert.rejects(verifyGitMedia(invalid,root),/Original media must remain local/);
});
