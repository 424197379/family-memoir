// 检查实际将上传的每个新提交，防止先提交原件、后删除仍把大对象传到 GitHub。
// 使用普通 git push，保留现有 Git 归因及其他全局 hooks。
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {verifyGitMedia} from './check-publish-media.mjs';
const exec = promisify(execFile);
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = async args=>(await exec('git',args,{cwd,maxBuffer:4*1024*1024})).stdout.trim();
assert.equal(await git(['branch','--show-current']), 'main', 'Publish from main only');
assert.equal(await git(['status','--porcelain']), '', 'Commit reviewed publication changes before pushing');
assert.equal(await git(['remote','get-url','origin']), 'https://github.com/424197379/family-memoir.git', 'Unexpected publication remote');
await git(['fetch','origin','main']);
await git(['merge-base','--is-ancestor','origin/main','HEAD']);
const commits = (await git(['rev-list','origin/main..HEAD'])).split('\n').filter(Boolean);
for (const commit of commits) await verifyGitMedia(commit,cwd);
console.log(`Verified ${commits.length} outgoing commits; no original media will be uploaded.`);
console.log(await git(['push','origin','HEAD:main']));
