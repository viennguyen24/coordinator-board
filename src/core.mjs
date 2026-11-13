import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const acpxPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/acpx/dist/cli.js');
const required = ['boardRepo', 'boardIssue', 'githubLogin', 'agentId', 'agentLabel', 'agentProfile', 'projectDir', 'stateDir', 'allowedSenders', 'allowedTaskRepos'];
const taskPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/;
const agentPattern = /^[A-Za-z0-9_-]+$/;

export function loadConfig(file, needsExecution = true) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of required) if (config[key] === undefined || config[key] === '') throw new Error(`Missing config: ${key}`);
  if (!Array.isArray(config.allowedSenders) || !config.allowedSenders.length) throw new Error('allowedSenders must be nonempty');
  if (!Array.isArray(config.allowedTaskRepos) || !config.allowedTaskRepos.length) throw new Error('allowedTaskRepos must be nonempty');
  if (!Number.isInteger(config.boardIssue) || config.boardIssue < 1) throw new Error('boardIssue must be positive');
  if (!agentPattern.test(config.agentId) || !agentPattern.test(config.agentProfile)) throw new Error('Invalid agent ID or profile');
  if (needsExecution && config.approveAll !== true) throw new Error('Set approveAll: true to allow unattended agent turns');
  config.projectDir = path.resolve(config.projectDir);
  config.stateDir = path.resolve(config.stateDir);
  if (!fs.statSync(config.projectDir).isDirectory()) throw new Error('projectDir must be a directory');
  config.commands ??= {};
  config.commands.gh ??= ['gh'];
  config.commands.acpx ??= fs.existsSync(acpxPath) ? [process.execPath, acpxPath] : ['acpx'];
  for (const name of ['gh', 'acpx']) if (!Array.isArray(config.commands[name]) || !config.commands[name].length) throw new Error(`Invalid ${name} command`);
  config.pollSeconds ??= 30;
  config.hostLockDir ??= path.join(os.tmpdir(), 'hackathon-agent-coordinator', crypto.createHash('sha256').update(os.homedir()).digest('hex').slice(0, 12), 'turn.lock');
  return config;
}

async function command(parts, args) {
  const { stdout } = await exec(parts[0], [...parts.slice(1), ...args], { maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

function stateFile(config) { return path.join(config.stateDir, 'state.json'); }
function readState(config) {
  try { return JSON.parse(fs.readFileSync(stateFile(config), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { cursor: null, messages: {}, sessions: {}, batches: {} }; throw error; }
}
function atomicWrite(file, content) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.renameSync(temp, file);
}
function saveState(config, state) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  atomicWrite(stateFile(config), JSON.stringify(state, null, 2) + '\n');
  const rows = Object.entries(state.sessions).map(([task, session]) => `| ${task} | ${session.profile} | ${session.name} | ${session.recordId} | ${session.cwd} |`);
  atomicWrite(path.join(config.stateDir, 'session-map.md'), ['# Local task sessions', '', '| Task | acpx profile | Session name | Local record ID | Working directory |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n'));
}

function lock(dir) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { fs.mkdirSync(dir); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid;
    try { pid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8')); } catch { /* incomplete lock */ }
    if (pid) {
      try { process.kill(pid, 0); throw new Error(`Lock is held by process ${pid}`); }
      catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    } else throw new Error(`Lock requires operator inspection: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
  }
  fs.writeFileSync(path.join(dir, 'pid'), String(process.pid));
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

async function gh(config, endpoint, body) {
  const args = ['api', endpoint];
  if (body !== undefined) args.push('-f', `body=${body}`);
  return JSON.parse(await command(config.commands.gh, args));
}

async function comments(config) {
  const all = [];
  for (let page = 1; ; page++) {
    const chunk = await gh(config, `repos/${config.boardRepo}/issues/${config.boardIssue}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(chunk)) throw new Error('GitHub comments response was not an array');
    all.push(...chunk);
    if (chunk.length < 100) return all.sort((a, b) => a.id - b.id);
  }
}

function parseMessage(comment, config) {
  const body = comment.body ?? '';
  const field = name => body.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim();
  const from = field('From');
  const to = field('To');
  const type = field('Type')?.toLowerCase();
  const task = field('Task');
  const text = body.split(/^Task:[^\n]*\n/im).slice(1).join('Task:').trim();
  if (!from || !agentPattern.test(from) || !taskPattern.test(task ?? '') || !text) return null;
  if (!['request', 'feedback', 'result'].includes(type)) return null;
  if (!config.allowedSenders.some(login => login.toLowerCase() === comment.user?.login?.toLowerCase())) return null;
  if (!config.allowedTaskRepos.includes(task.split('#')[0])) return null;
  const taggedAll = /(^|[^\w-])@all(?![\w-])/i.test(body);
  const escaped = config.githubLogin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taggedDirect = new RegExp(`(^|[^\\w-])@${escaped}(?![\\w-])`, 'i').test(body);
  if (!taggedAll && !(taggedDirect && to === config.agentId)) return null;
  return { id: comment.id, author: comment.user.login, from, to: taggedAll ? 'all' : to, type, task, body, status: 'pending' };
}

async function poll(config, state) {
  const fetched = await comments(config);
  if (state.cursor === null) {
    state.cursor = Math.max(0, ...fetched.map(comment => comment.id));
    saveState(config, state);
    return;
  }
  for (const comment of fetched) {
    if (comment.id <= state.cursor) continue;
    const message = parseMessage(comment, config);
    if (message) state.messages[comment.id] = message;
    state.cursor = comment.id;
    saveState(config, state);
  }
}

function sessionName(task, agentId) { return `task-${crypto.createHash('sha256').update(`${task}:${agentId}`).digest('hex').slice(0, 16)}`; }
async function acpx(config, args) { return command(config.commands.acpx, args); }

async function ensureSession(config, state, task) {
  if (state.sessions[task]) return state.sessions[task];
  const name = sessionName(task, config.agentId);
  const output = await acpx(config, ['--cwd', config.projectDir, '--format', 'json', config.agentProfile, 'sessions', 'ensure', '--name', name]);
  const recordId = JSON.parse(output).acpxRecordId;
  if (!recordId) throw new Error('acpx did not return a local record ID');
  const session = { name, recordId, cwd: config.projectDir, profile: config.agentProfile };
  state.sessions[task] = session;
  saveState(config, state);
  return session;
}

function turnOutput(output) {
  let text = '';
  let ended = false;
  for (const line of output.split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.method === 'session/update' && event.params?.update?.sessionUpdate === 'agent_message_chunk') text += event.params.update.content?.text ?? '';
    if (event.result?.stopReason === 'end_turn') ended = true;
  }
  if (!ended) throw new Error('acpx turn ended without end_turn');
  return text.trim();
}

async function postResult(config, state, batch, sender, output) {
  const ids = batch.ids.filter(id => state.messages[id].from === sender);
  const login = state.messages[ids[0]].author;
  const deliveryId = crypto.createHash('sha256').update(`${config.agentId}:${batch.task}:${ids.join(',')}`).digest('hex').slice(0, 20);
  const existing = (await comments(config)).find(comment => comment.body?.includes(`Delivery-ID: ${deliveryId}`));
  if (existing) return existing.id;
  const body = `[${config.agentLabel}] @${login}\nFrom: ${config.agentId}\nTo: ${sender}\nType: result\nTask: ${batch.task}\nAddresses: ${ids.join(', ')}\nDelivery-ID: ${deliveryId}\n${output || 'Turn completed without a written summary.'}`;
  return (await gh(config, `repos/${config.boardRepo}/issues/${config.boardIssue}/comments`, body)).id;
}

async function dispatch(config, state) {
  const pending = Object.values(state.messages).filter(message => message.status === 'pending');
  if (!pending.length) return false;
  const task = pending[0].task;
  const ids = pending.filter(message => message.task === task).map(message => message.id);
  let unlock;
  try { unlock = lock(config.hostLockDir); } catch (error) { if (error.message.startsWith('Lock is held')) return false; throw error; }
  let batch;
  try {
    const [repo, issue] = task.split('#');
    const taskIssue = await gh(config, `repos/${repo}/issues/${issue}`);
    const session = await ensureSession(config, state, task);
    batch = { id: crypto.randomUUID(), task, ids, status: 'in_progress', replies: {} };
    state.batches[batch.id] = batch;
    for (const id of ids) state.messages[id].status = 'in_progress';
    saveState(config, state);
    const prompt = `Task ${task}: ${taskIssue.title}\n${taskIssue.body ?? ''}\n\nMessages:\n${ids.map(id => { const m = state.messages[id]; return `Board comment #${id} from ${m.from} (@${m.author}), Type: ${m.type}\n${m.body}`; }).join('\n\n')}\n\nWhen you need to send a new request or feedback, use the coordinator send command. Otherwise finish this turn with a concise summary.`;
    const output = turnOutput(await acpx(config, ['--cwd', config.projectDir, '--format', 'json', '--json-strict', '--approve-all', '--non-interactive-permissions', 'fail', '--ttl', '1', config.agentProfile, '-s', session.name, prompt]));
    batch.output = output;
    batch.status = 'posting';
    saveState(config, state);
    await deliver(config, state, batch);
    return true;
  } catch (error) {
    if (batch && batch.status === 'in_progress') {
      batch.status = 'blocked';
      batch.error = error.message;
      for (const id of ids) state.messages[id].status = 'blocked';
      saveState(config, state);
    }
    console.error(`Task ${task}: ${error.message}`);
    return false;
  } finally { unlock(); }
}

async function deliver(config, state, batch) {
  const senders = [...new Set(batch.ids.filter(id => state.messages[id].type !== 'result').map(id => state.messages[id].from))];
  for (const sender of senders) {
    if (batch.replies[sender]) continue;
    batch.replies[sender] = await postResult(config, state, batch, sender, batch.output);
    saveState(config, state);
  }
  batch.status = 'handled';
  for (const id of batch.ids) state.messages[id].status = 'handled';
  saveState(config, state);
}

export async function run(config, once = false) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  let unlock;
  try { unlock = lock(path.join(config.stateDir, 'instance.lock')); }
  catch (error) {
    if (error.message.startsWith('Lock is held') || error.message.startsWith('Lock requires')) {
      throw new Error(`State directory already in use (${config.stateDir}): ${error.message}`);
    }
    throw error;
  }
  const state = readState(config);
  saveState(config, state);
  for (const batch of Object.values(state.batches)) if (batch.status === 'in_progress') {
    batch.status = 'blocked';
    batch.error = 'Coordinator stopped during turn; outcome unknown';
    for (const id of batch.ids) state.messages[id].status = 'blocked';
  }
  saveState(config, state);
  try {
    do {
      try { await poll(config, state); } catch (error) { console.error(`Poll failed: ${error.message}`); }
      for (const batch of Object.values(state.batches)) if (batch.status === 'posting') {
        try { await deliver(config, state, batch); } catch (error) { console.error(`Post failed: ${error.message}`); }
      }
      while (await dispatch(config, state)) {
        try { await poll(config, state); } catch (error) { console.error(`Poll failed: ${error.message}`); }
      }
      if (!once) await new Promise(resolve => setTimeout(resolve, config.pollSeconds * 1000));
    } while (!once);
  } finally { unlock(); }
}

export async function send(config, options) {
  if (!taskPattern.test(options.task) || !agentPattern.test(options.to ?? '') && !options.all) throw new Error('Invalid task or recipient');
  if (!['request', 'feedback'].includes(options.type)) throw new Error('Type must be request or feedback');
  if (!options.all && !/^[A-Za-z0-9-]+$/.test(options.login ?? '')) throw new Error('Recipient GitHub login required');
  if (!options.body?.trim()) throw new Error('Message body required');
  const text = `[${config.agentLabel}] @${options.all ? 'all' : options.login}\nFrom: ${config.agentId}\n${options.all ? '' : `To: ${options.to}\n`}Type: ${options.type}\nTask: ${options.task}\n${options.body.trim()}`;
  return gh(config, `repos/${config.boardRepo}/issues/${config.boardIssue}/comments`, text);
}

export function status(config) { return readState(config); }

export async function resolve(config, task, action) {
  const state = readState(config);
  const batch = Object.values(state.batches).find(item => item.task === task && item.status === 'blocked');
  if (!batch) throw new Error('No blocked batch for task');
  if (action === 'retry') {
    batch.status = 'retried';
    for (const id of batch.ids) state.messages[id].status = 'pending';
  } else if (action === 'fail') {
    batch.output = 'Turn outcome unknown; operator chose not to retry.';
    batch.status = 'posting';
    saveState(config, state);
    await deliver(config, state, batch);
  } else throw new Error('Choose --retry or --fail');
  saveState(config, state);
}
