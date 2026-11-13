import fs from 'node:fs';

const [mode, file, ...args] = process.argv.slice(2);
const db = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(db));
if (mode === 'gh') {
  const endpoint = args.find(arg => arg.startsWith('repos/'));
  db.ghCalls ??= [];
  db.ghCalls.push(endpoint);
  save();
  if (args.some(arg => arg.startsWith('-f'))) {
    if (db.failPost) process.exit(1);
    const body = args.find(arg => arg.startsWith('body='))?.slice(5);
    const id = Math.max(0, ...db.comments.map(comment => comment.id)) + 1;
    const comment = { id, body, user: { login: db.login }, created_at: new Date().toISOString() };
    db.comments.push(comment);
    save();
    console.log(JSON.stringify(comment));
  } else if (endpoint?.includes('/comments')) {
    const page = Number(new URL(`https://example.test/${endpoint}`).searchParams.get('page') ?? 1);
    console.log(JSON.stringify(db.comments.slice((page - 1) * 100, page * 100)));
  } else if (endpoint === `repos/${db.boardRepo}/issues/${db.boardIssue}`) {
    console.log(JSON.stringify({ comments: db.comments.length }));
  } else if (endpoint?.includes('/issues/')) {
    if (db.failTaskIssue) process.exit(1);
    console.log(JSON.stringify(db.taskIssue));
  } else { process.exit(2); }
} else if (mode === 'acpx') {
  db.calls ??= [];
  db.calls.push(args);
  save();
  if (args.includes('ensure')) {
    const name = args[args.indexOf('--name') + 1];
    console.log(JSON.stringify({ acpxRecordId: `session-${name}` }));
  } else {
    if (db.injectDuringTurn) {
      db.comments.push(db.injectDuringTurn);
      delete db.injectDuringTurn;
      save();
    }
    if (db.failTurn) process.exit(1);
    console.log(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Endpoint ready' } } } }));
    console.log(JSON.stringify({ jsonrpc: '2.0', id: 'req-1', result: { stopReason: 'end_turn' } }));
  }
} else { process.exit(2); }
