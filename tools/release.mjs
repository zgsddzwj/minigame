import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Workflow, hash, readJson, writeJson, validateRelease, inside, now, verifyApproval, fingerprint } from './core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flow = new Workflow(root);
const require = createRequire(import.meta.url);
const [command = 'help', ...args] = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };

function approvedCandidate(state) {
  const approval = state.approvals.findLast(item => item.id === 'H5' && !item.invalidatedAt && item.mode === 'live');
  if (!approval) throw new Error('需要真实流程的有效 H5 候选验收');
  verifyApproval(flow, approval);
  const sha = hash(fs.readFileSync(inside(flow.workspace, 'deliverables/release-manifest.json')));
  if (approval.releaseManifestSha256 !== sha) throw new Error('候选清单已变更，必须返工并重新验收');
  if (state.releaseManifestSha256 !== sha) throw new Error('发行状态与当前候选不匹配');
  return { manifest: validateRelease(flow.workspace), sha };
}

try {
  if (command === 'help') {
    console.log('node tools/release.mjs plan\nnode tools/release.mjs upload --authorize-version 0.1.0\nnode tools/release.mjs record <平台回执.json>\n\n上传需要额外安装并锁定 miniprogram-ci，环境变量 WECHAT_PRIVATE_KEY_PATH 指向仓库外私钥。\nrecord 只记录用户提供的真实平台回执，不调用提审/发布 API。详见 docs/RELEASE.md。');
  } else {
    await flow.locked(async () => {
      const state = flow.load();
      const { manifest, sha } = approvedCandidate(state);
      if (command === 'plan') {
        console.log(JSON.stringify({ version: manifest.version, appId: manifest.appId, manifestSha256: sha, packageDir: manifest.packageDir, publicationStatus: state.publicationStatus, note: '尚未执行平台操作' }, null, 2));
      } else if (command === 'upload') {
        if (option('authorize-version') !== manifest.version) throw new Error('必须明确指定 --authorize-version 与候选版本相同；H5 不隐含上传授权');
        if (state.publicationStatus !== 'not_started') throw new Error('已存在上传/发布操作记录。先核对平台回执，不自动重复上传。');
        const privateKeyPath = process.env.WECHAT_PRIVATE_KEY_PATH;
        if (!privateKeyPath || !fs.existsSync(privateKeyPath)) throw new Error('未配置有效 WECHAT_PRIVATE_KEY_PATH');
        const keyPath = path.resolve(privateKeyPath);
        if (keyPath.startsWith(root + path.sep)) throw new Error('上传私钥必须放在项目目录外');
        let ci;
        try { ci = require('miniprogram-ci'); } catch { throw new Error('先安装并锁定官方 miniprogram-ci：npm install --save-dev --save-exact miniprogram-ci'); }
        const project = new ci.Project({ appid: manifest.appId, type: 'miniGame', projectPath: inside(flow.workspace, manifest.packageDir), privateKeyPath: keyPath, ignores: ['node_modules/**/*'] });
        state.publicationStatus = 'uploading';
        state.releaseVersion = manifest.version; state.releaseManifestSha256 = sha;
        flow.save(state); flow.event(state, 'upload_started', { version: manifest.version, manifestSha256: sha });
        try {
          const result = await ci.upload({ project, version: manifest.version, desc: `已验收候选 ${manifest.version}`, setting: { es6: true, minify: true }, robot: 1, onProgressUpdate: () => {} });
          writeJson(path.join(flow.runtime, 'upload-receipt.json'), { at: now(), version: manifest.version, manifestSha256: sha, result });
          state.publicationStatus = 'uploaded'; flow.save(state);
          console.log('开发版本已上传。尚未提交审核或正式发布。');
        } catch (error) {
          state.publicationStatus = 'upload_unknown'; flow.save(state);
          throw new Error(`上传结果需核对，禁止盲目重试：${error.message}`);
        }
      } else if (command === 'record') {
        if (!args[0]) throw new Error('需要平台回执 JSON 路径');
        const receipt = readJson(path.resolve(args[0]));
        const transitions = { not_started: ['uploaded'], uploading: ['uploaded', 'not_started'], upload_unknown: ['uploaded', 'not_started'], uploaded: ['submitted'], submitted: ['approved', 'rejected'], rejected: ['submitted'], approved: ['released'], released: [] };
        if (!(transitions[state.publicationStatus] || []).includes(receipt.status)) throw new Error(`不允许从 ${state.publicationStatus} 跳到 ${receipt.status}`);
        if (receipt.version !== manifest.version || receipt.manifestSha256 !== sha || !receipt.operator || !receipt.platformRecordId || !Number.isFinite(Date.parse(receipt.at)) || !receipt.note || !Array.isArray(receipt.evidence) || !receipt.evidence.length) throw new Error('回执需包含相同版本/清单哈希、操作人、平台记录 ID、有效时间、说明及证据文件');
        const evidence = receipt.evidence.map(relative => {
          if (!relative.startsWith('evidence/platform/')) throw new Error('平台回执附件只能放在 evidence/platform/ 下');
          return { path: relative, sha256: hash(fs.readFileSync(inside(flow.workspace, relative))) };
        });
        flow.event(state, 'platform_receipt', { ...receipt, evidence, source: 'human_attested' });
        state.publicationStatus = receipt.status;
        state.releaseVersion = manifest.version; state.releaseManifestSha256 = sha;
        state.boundaryHash = fingerprint(flow.workspace);
        flow.save(state);
        console.log(`已记录用户核对的微信平台状态：${receipt.status}。此命令不会代替平台操作。`);
      } else throw new Error('未知命令，运行 node tools/release.mjs help');
    });
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
