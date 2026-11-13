import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setup } from './helpers.mjs';

test('second coordinator instance refuses the same state directory', async () => {
  const t = setup();
  const lockDir = path.join(t.root, 'state/instance.lock');
  fs.mkdirSync(path.join(t.root, 'state'), { recursive: true });
  fs.mkdirSync(lockDir);
  fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  try {
    const result = t.run('run', '--once');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already in use/);
    assert.equal(t.readDb().calls, undefined);
    assert.equal(t.readDb().ghCalls, undefined);
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
    t.cleanup();
  }
});

test('live second process is rejected while the first still holds the lock', async () => {
  const t = setup();
  const config = JSON.parse(fs.readFileSync(t.configPath, 'utf8'));
  config.pollSeconds = 30;
  fs.writeFileSync(t.configPath, JSON.stringify(config));
  const first = spawn(process.execPath, ['bin/coordinator.mjs', 'run', '--config', t.configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('first instance never locked')), 5000);
      const check = () => {
        if (fs.existsSync(path.join(t.root, 'state/instance.lock/pid'))) {
          clearTimeout(timer);
          resolve();
        } else setTimeout(check, 25);
      };
      check();
    });
    const second = t.run('run', '--once');
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /already in use/);
  } finally {
    first.kill('SIGTERM');
    await new Promise(resolve => first.once('exit', resolve));
    t.cleanup();
  }
});
