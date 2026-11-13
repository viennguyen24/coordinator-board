import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coordinator-test-'));
  const fixture = path.resolve('test/fixtures/command.mjs');
  const dbPath = path.join(root, 'db.json');
  const configPath = path.join(root, 'config.json');
  const db = { boardRepo: 'team/repo', boardIssue: 1, login: 'same-account', taskIssue: { title: 'Add endpoint', body: 'Implement GET /health' }, comments: [] };
  const config = { boardRepo: 'team/repo', boardIssue: 1, githubLogin: 'same-account', agentId: 'agent-b', agentLabel: "B's Codex", agentProfile: 'codex', projectDir: root, stateDir: path.join(root, 'state'), hostLockDir: path.join(root, 'host.lock'), allowedSenders: ['same-account'], allowedTaskRepos: ['team/repo'], approveAll: true, commands: { gh: [process.execPath, fixture, 'gh', dbPath], acpx: [process.execPath, fixture, 'acpx', dbPath] } };
  const writeDb = value => fs.writeFileSync(dbPath, JSON.stringify(value));
  writeDb(db);
  fs.writeFileSync(configPath, JSON.stringify(config));
  return {
    root, dbPath, configPath, config,
    readDb: () => JSON.parse(fs.readFileSync(dbPath, 'utf8')),
    writeDb,
    run: (...args) => spawnSync(process.execPath, ['bin/coordinator.mjs', ...args, '--config', configPath], { encoding: 'utf8' }),
    runWithInput: (input, ...args) => spawnSync(process.execPath, ['bin/coordinator.mjs', ...args, '--config', configPath], { encoding: 'utf8', input }),
    state: () => JSON.parse(fs.readFileSync(path.join(root, 'state/state.json'), 'utf8')),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

export const request = (id, from = 'agent-a', text = 'Implement endpoint', task = 'team/repo#12') => ({ id, user: { login: 'same-account' }, created_at: `2026-11-13T00:00:${String(id).padStart(2, '0')}Z`, body: `[A's Codex] @same-account\nFrom: ${from}\nTo: agent-b\nType: request\nTask: ${task}\n${text}` });

export const result = (id, from = 'agent-b', to = 'agent-a', text = 'Done', task = 'team/repo#12', addresses = '1') => ({ id, user: { login: 'same-account' }, created_at: `2026-11-13T00:00:${String(id).padStart(2, '0')}Z`, body: `[B's Codex] @same-account\nFrom: ${from}\nTo: ${to}\nType: result\nTask: ${task}\nAddresses: ${addresses}\n${text}` });
