import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup, request, result } from './helpers.mjs';

test('failed operator resolution keeps a durable post retry without rerunning agent', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1));
    db.failTurn = true;
    t.writeDb(db);
    t.run('run', '--once');
    assert.equal(Object.values(t.state().batches)[0].status, 'blocked');
    const failed = t.readDb();
    failed.failTurn = false;
    failed.failPost = true;
    t.writeDb(failed);
    t.run('resolve', '--task', 'team/repo#12', '--fail');
    assert.equal(Object.values(t.state().batches)[0].status, 'posting');
    const restored = t.readDb();
    restored.failPost = false;
    t.writeDb(restored);
    t.run('run', '--once');
    const final = t.readDb();
    assert.equal(final.comments.filter(comment => comment.body?.includes('Delivery-ID:')).length, 1);
    assert.equal(final.calls.filter(call => !call.includes('ensure')).length, 1);
  } finally { t.cleanup(); }
});

test('posts one result per sender listing only that sender source IDs', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1, 'agent-a', 'From A'), request(2, 'agent-c', 'From C'));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const results = t.readDb().comments.filter(comment => comment.body?.includes('Type: result'));
    assert.equal(results.length, 2);
    const forA = results.find(comment => comment.body.includes('To: agent-a'));
    const forC = results.find(comment => comment.body.includes('To: agent-c'));
    assert.match(forA.body, /Addresses: 1\b/);
    assert.doesNotMatch(forA.body, /Addresses: 1, 2/);
    assert.match(forC.body, /Addresses: 2\b/);
    assert.match(forA.body, /Endpoint ready/);
  } finally { t.cleanup(); }
});

test('processing a result does not post another result unless send is used', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(result(1, 'agent-b', 'agent-a', 'Finished work'));
    // Coordinator is agent-b; address the result to agent-b so it is actionable
    db.comments[0].body = db.comments[0].body.replace('To: agent-a', 'To: agent-b').replace('From: agent-b', 'From: agent-a');
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const after = t.readDb();
    assert.equal(after.calls.filter(call => !call.includes('ensure')).length, 1);
    assert.equal(after.comments.filter(comment => comment.body?.includes('Type: result') && comment.id > 1).length, 0);
    assert.equal(t.state().messages['1'].status, 'handled');
  } finally { t.cleanup(); }
});

test('send posts an explicit follow-up request for another agent', () => {
  const t = setup();
  try {
    const sent = t.runWithInput('Please review the endpoint', 'send', '--task', 'team/repo#12', '--type', 'request', '--to', 'agent-c', '--login', 'other-login', '--body-file', '-');
    assert.equal(sent.status, 0, sent.stderr);
    const posted = t.readDb().comments.at(-1);
    assert.match(posted.body, /To: agent-c/);
    assert.match(posted.body, /Type: request/);
    assert.match(posted.body, /Please review the endpoint/);
    assert.match(posted.body, /From: agent-b/);
  } finally { t.cleanup(); }
});

test('result post retry reuses Delivery-ID and does not duplicate the board comment', () => {
  const t = setup();
  try {
    assert.equal(t.run('run', '--once').status, 0);
    const db = t.readDb();
    db.comments.push(request(1));
    t.writeDb(db);
    assert.equal(t.run('run', '--once').status, 0);
    const posted = t.readDb().comments.find(comment => comment.body?.includes('Delivery-ID:'));
    assert.ok(posted);
    const delivery = posted.body.match(/Delivery-ID: (\S+)/)[1];
    const state = t.state();
    const batch = Object.values(state.batches)[0];
    batch.status = 'posting';
    delete batch.replies['agent-a'];
    state.messages['1'].status = 'in_progress';
    fs.writeFileSync(`${t.root}/state/state.json`, JSON.stringify(state, null, 2));
    assert.equal(t.run('run', '--once').status, 0);
    const finals = t.readDb().comments.filter(comment => comment.body?.includes(`Delivery-ID: ${delivery}`));
    assert.equal(finals.length, 1);
    assert.equal(t.state().messages['1'].status, 'handled');
  } finally { t.cleanup(); }
});
