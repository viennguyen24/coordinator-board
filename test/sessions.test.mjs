import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, request } from './helpers.mjs';

test('creates a named session once and resumes it for follow-up on the same task', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1, 'agent-a', 'First request'));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const first = t.state();
    assert.equal(Object.keys(first.sessions).length, 1);
    assert.equal(first.sessions['team/repo#12'].cwd, t.root);
    assert.ok(first.sessions['team/repo#12'].recordId);
    const map = fs.readFileSync(path.join(t.root, 'state/session-map.md'), 'utf8');
    assert.match(map, /team\/repo#12/);

    const next = t.readDb();
    next.comments.push(request(10, 'agent-a', 'Follow-up feedback'));
    // rewrite body type to feedback while keeping routing
    next.comments.at(-1).body = next.comments.at(-1).body.replace('Type: request', 'Type: feedback');
    t.writeDb(next);
    assert.equal(t.run('run', '--once').status, 0);
    const second = t.state();
    assert.equal(Object.keys(second.sessions).length, 1);
    assert.equal(second.sessions['team/repo#12'].recordId, first.sessions['team/repo#12'].recordId);
    const prompts = t.readDb().calls.filter(call => !call.includes('ensure'));
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every(call => call.includes('-s') && call.includes(first.sessions['team/repo#12'].name)));
  } finally { t.cleanup(); }
});

test('batches pending comments into one prompt and queues arrivals during the turn', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1, 'agent-a', 'Part one'), request(2, 'agent-c', 'Part two'));
    db.injectDuringTurn = request(3, 'agent-a', 'Arrived mid-turn');
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const prompts = t.readDb().calls.filter(call => !call.includes('ensure'));
    assert.equal(prompts.length, 2);
    assert.match(JSON.stringify(prompts[0]), /Part one/);
    assert.match(JSON.stringify(prompts[0]), /Part two/);
    assert.doesNotMatch(JSON.stringify(prompts[0]), /Arrived mid-turn/);
    assert.match(JSON.stringify(prompts[1]), /Arrived mid-turn/);
    assert.doesNotMatch(JSON.stringify(prompts[1]), /Part one/);
  } finally { t.cleanup(); }
});

test('serializes turns across tasks and keeps distinct saved sessions', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1, 'agent-a', 'Task twelve', 'team/repo#12'), request(2, 'agent-a', 'Task thirteen', 'team/repo#13'));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const state = t.state();
    assert.ok(state.sessions['team/repo#12']);
    assert.ok(state.sessions['team/repo#13']);
    assert.notEqual(state.sessions['team/repo#12'].name, state.sessions['team/repo#13'].name);
    const prompts = t.readDb().calls.filter(call => !call.includes('ensure'));
    assert.equal(prompts.length, 2);
  } finally { t.cleanup(); }
});

test('keeps messages pending when the task issue cannot be fetched', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1));
    db.failTaskIssue = true;
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const state = t.state();
    assert.equal(state.messages['1'].status, 'pending');
    assert.equal(t.readDb().calls, undefined);
  } finally { t.cleanup(); }
});

test('never deletes a task mapping after a completed turn', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    assert.ok(t.state().sessions['team/repo#12']);
    assert.equal(t.state().messages['1'].status, 'handled');
  } finally { t.cleanup(); }
});
