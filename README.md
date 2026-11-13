# Hackathon agent coordinator

Local coordinator that watches a shared GitHub board issue, dispatches addressed work into acpx coding-agent sessions, and posts results back to the board.

## Requirements

- Node.js 22.13+
- [GitHub CLI](https://cli.github.com/) authenticated for the board repository
- [acpx](https://github.com/openclaw/acpx) 0.22.0 (pinned via this package)
- An installed acpx agent profile (Codex, Claude Code, Cursor, Copilot CLI, …)

## Setup

```bash
npm install
```

Create a config file:

```json
{
  "boardRepo": "owner/board-repo",
  "boardIssue": 1,
  "githubLogin": "your-login",
  "agentId": "agent-b",
  "agentLabel": "B's Codex",
  "agentProfile": "codex",
  "projectDir": "/absolute/path/to/project",
  "stateDir": "/absolute/path/to/.coordinator",
  "allowedSenders": ["teammate-login"],
  "allowedTaskRepos": ["owner/task-repo"],
  "approveAll": true,
  "pollSeconds": 30
}
```

`approveAll: true` is required for unattended turns. Prefer a disposable board while testing.

## Commands

```bash
# Poll once (useful in tests) or keep listening
node bin/coordinator.mjs run --config ./config.json --once
node bin/coordinator.mjs run --config ./config.json

# Inspect durable state
node bin/coordinator.mjs status --config ./config.json

# Explicit follow-up from an agent turn
node bin/coordinator.mjs send --config ./config.json \
  --task owner/repo#12 --type feedback --to agent-a --login teammate-login \
  --body-file - <<<'Please adjust the handler'

# Resolve a blocked task after a crash
node bin/coordinator.mjs resolve --config ./config.json --task owner/repo#12 --retry
node bin/coordinator.mjs resolve --config ./config.json --task owner/repo#12 --fail
```

Session mappings are written to `stateDir/session-map.md`. Inspect conversation history with acpx for the named session recorded there.

## Message shape

```text
[A's Codex] @recipient-login
To: agent-b
From: agent-a
Type: request
Task: owner/repo#12
Please implement the endpoint described in the task issue.
```

`Type: request` and `Type: feedback` start turns. `Type: result` resumes the requester without auto-replying. `Type: info` is ignored. `@all` reaches every coordinator and omits `To`.

## Tests

```bash
npm test
```

Tests replace `gh` and `acpx` with fixtures. They cover routing, polling/cursors, sessions/batching, replies/recovery, and instance locks.

## Notes

- Only one coordinator may own a `stateDir` at a time.
- Only one agent turn runs on the host at a time; other tasks wait.
- Interrupted in-progress turns become blocked and need `resolve`.
- Task mappings and acpx sessions are never deleted automatically.
