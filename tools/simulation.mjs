// Only for isolated demos and tests. Never use this provider for a live workflow.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, inside, packageHash, packageInventory } from './core.mjs';

export function copyFixture(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['workflow.config.json', 'AGENTS.md', 'agents', 'workflow']) fs.cpSync(path.join(source, name), path.join(target, name), { recursive: true });
  fs.mkdirSync(path.join(target, 'game-workspace'), { recursive: true });
  fs.writeFileSync(path.join(target, 'game-workspace/brief.md'), '# SIMULATED\nOnly for workflow control tests. Not a game.\n');
}
export async function simulatedProvider({ stage, reviewer, workspace }) {
  if (!reviewer) {
    for (const relative of stage.outputs) {
      const file = inside(workspace, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (relative.endsWith('.json')) writeJson(file, { simulated: true, stage: stage.id, description: 'Not a real game artifact' });
      else if (relative.endsWith('.png')) fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=', 'base64'));
      else if (relative.endsWith('.mjs')) fs.writeFileSync(file, 'console.log("SIMULATED CONTROL TEST ONLY; no game tested");\n');
      else fs.writeFileSync(file, `# SIMULATED ${stage.id}\n\nOnly tests orchestration. No gameplay, device test, or release has occurred.\n`);
    }
    if (stage.id === '07-qa') {
      const packageDir = 'game/build/wechatgame';
      fs.mkdirSync(inside(workspace, packageDir), { recursive: true });
      fs.writeFileSync(inside(workspace, `${packageDir}/game.js`), '// SIMULATED PACKAGE; not a game\n');
      writeJson(inside(workspace, 'deliverables/qa-results.json'), { simulated: true, automaticPassed: true, criticalIssues: 0, buildVersion: '0.0.0-demo', packageDir, packageHash: packageHash(inside(workspace, packageDir)), deviceStatus: 'pending_human' });
    }
    if (stage.id === '08-release') {
      const qa = readJson(inside(workspace, 'deliverables/qa-results.json'));
      writeJson(inside(workspace, 'deliverables/release-manifest.json'), { simulated: true, version: qa.buildVersion, packageDir: qa.packageDir, files: packageInventory(inside(workspace, qa.packageDir)) });
    }
  }
  return { status: 'done', summary: 'SIMULATED：只验证控制器流转，没有游戏或真实平台动作。', artifacts: stage.outputs, checks: [{ name: 'simulated control flow', passed: true, evidence: stage.outputs[0] }], blockers: [], repairStage: null };
}
export function simulatedDeviceEvidence(flow) {
  const qa = readJson(inside(flow.workspace, 'deliverables/qa-results.json'));
  const relative = 'evidence/device/simulated.txt';
  fs.mkdirSync(path.dirname(inside(flow.workspace, relative)), { recursive: true });
  fs.writeFileSync(inside(flow.workspace, relative), 'SIMULATED; no physical device was tested.');
  const file = path.join(flow.runtime, 'simulated-device.json');
  writeJson(file, { simulated: true, result: 'pass', buildVersion: qa.buildVersion, packageHash: qa.packageHash, tester: 'simulation', devices: [{ model: 'simulated iPhone', os: 'iOS simulated', wechatVersion: 'simulated', result: 'pass', coldStartMs: 1, averageFps: 60 }, { model: 'simulated Android', os: 'Android simulated', wechatVersion: 'simulated', result: 'pass', coldStartMs: 1, averageFps: 60 }], attachments: [relative] });
  return file;
}
