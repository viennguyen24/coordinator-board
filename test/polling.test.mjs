import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, request } from './helpers.mjs';

test('first start skips old work and later polls use an incremental cursor', () => {
  const t = setup();
  try {
    const initial = t.readDb();
    initial.comments.push(request(1, 'agent-a', 'Old task'));
    t.writeDb(initial);
    assert.equal(t.run('run', '--once').status, 0);
    assert.equal(t.readDb().calls, undefined);
    assert.equal(t.state().cursor, 1);
    const next = t.readDb();
    next.comments.push(request(2, 'agent-a', 'New task'));
    t.writeDb(next);
    assert.equal(t.run('run', '--once').status, 0);
    const after = t.readDb();
    assert.match(JSON.stringify(after.calls), /New task/);
    assert.doesNotMatch(JSON.stringify(after.calls), /Old task/);
    assert.ok(t.state().cursor >= 2);
  } finally { t.cleanup(); }
});

test('restart keeps pending work and blocks an interrupted in-progress turn', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const statePath = path.join(t.root, 'state/state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const state = {
      cursor: 2,
      messages: {
        1: { ...request(1), status: 'pending' },
        2: { ...request(2, 'agent-a', 'Interrupted'), status: 'in_progress' }
      },
      sessions: { 'team/repo#12': { name: 'task-abc', recordId: 'session-1', cwd: t.root, profile: 'codex' } },
      batches: { 'batch-1': { id: 'batch-1', task: 'team/repo#12', ids: [2], status: 'in_progress', replies: {} } }
    };
    // request() returns a comment shape; flatten to message shape for state
    state.messages[1] = { id: 1, author: 'same-account', from: 'agent-a', to: 'agent-b', type: 'request', task: 'team/repo#12', body: request(1).body, status: 'pending' };
    state.messages[2] = { id: 2, author: 'same-account', from: 'agent-a', to: 'agent-b', type: 'request', task: 'team/repo#12', body: request(2).body, status: 'in_progress' };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    const db = t.readDb();
    db.comments.push(request(1), request(2, 'agent-a', 'Interrupted'));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const after = t.state();
    assert.equal(after.messages['2'].status, 'blocked');
    assert.equal(after.batches['batch-1'].status, 'blocked');
    assert.equal(after.messages['1'].status, 'handled');
    assert.equal(t.readDb().calls.filter(call => !call.includes('ensure')).length, 1);
  } finally { t.cleanup(); }
});
