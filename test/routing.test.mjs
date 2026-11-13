import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './helpers.mjs';

test('only an explicitly tagged direct message starts an agent turn', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments = [
      { id: 1, user: { login: 'same-account' }, created_at: '2026-11-13T00:00:00Z', body: "[A's Codex]\nFrom: agent-a\nTo: agent-b\nType: request\nTask: team/repo#12\nUntagged" },
      { id: 2, user: { login: 'same-account' }, created_at: '2026-11-13T00:00:01Z', body: "[A's Codex] @same-account\nFrom: agent-a\nTo: agent-b\nType: request\nTask: team/repo#12\nImplement endpoint" }
    ];
    t.writeDb(db);
    const result = t.run('run', '--once');
    assert.equal(result.status, 0, result.stderr);
    const after = t.readDb();
    assert.equal(after.calls.filter(call => !call.includes('ensure')).length, 1);
    assert.match(JSON.stringify(after.calls), /Implement endpoint/);
    assert.doesNotMatch(JSON.stringify(after.calls), /Untagged/);
  } finally { t.cleanup(); }
});

test('Type info and disallowed repos or senders never start a turn', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(
      { id: 1, user: { login: 'same-account' }, created_at: '2026-11-13T00:00:01Z', body: "[A's Codex] @same-account\nFrom: agent-a\nTo: agent-b\nType: info\nTask: team/repo#12\nJust FYI" },
      { id: 2, user: { login: 'outsider' }, created_at: '2026-11-13T00:00:02Z', body: "[A's Codex] @same-account\nFrom: agent-a\nTo: agent-b\nType: request\nTask: team/repo#12\nFrom outsider" },
      { id: 3, user: { login: 'same-account' }, created_at: '2026-11-13T00:00:03Z', body: "[A's Codex] @same-account\nFrom: agent-a\nTo: agent-b\nType: request\nTask: other/repo#12\nWrong repo" },
      { id: 4, user: { login: 'same-account' }, created_at: '2026-11-13T00:00:04Z', body: "[A's Codex] @all\nFrom: agent-a\nType: request\nTask: team/repo#12\nBroadcast work" }
    );
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const after = t.readDb();
    assert.equal(after.calls.filter(call => !call.includes('ensure')).length, 1);
    assert.match(JSON.stringify(after.calls), /Broadcast work/);
    assert.doesNotMatch(JSON.stringify(after.calls), /Just FYI|From outsider|Wrong repo/);
  } finally { t.cleanup(); }
});

test('rejects incomplete config before any work', () => {
  const t = setup();
  try {
    const config = { ...t.config };
    delete config.approveAll;
    fs.writeFileSync(t.configPath, JSON.stringify(config));
    const result = t.run('run', '--once');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /approveAll/);
  } finally { t.cleanup(); }
});
