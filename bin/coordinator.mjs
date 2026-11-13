#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig, run, send, status, resolve } from '../src/core.mjs';

const [command, ...args] = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
try {
  if (!['run', 'send', 'status', 'resolve'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const config = loadConfig(option('--config'), command === 'run');
  if (command === 'run') await run(config, args.includes('--once'));
  if (command === 'status') console.log(JSON.stringify(status(config), null, 2));
  if (command === 'send') {
    const body = option('--body-file') === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(option('--body-file'), 'utf8');
    const posted = await send(config, { task: option('--task'), type: option('--type'), to: option('--to'), login: option('--login'), all: args.includes('--all'), body });
    console.log(posted.html_url ?? posted.id);
  }
  if (command === 'resolve') await resolve(config, option('--task'), args.includes('--retry') ? 'retry' : args.includes('--fail') ? 'fail' : undefined);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
