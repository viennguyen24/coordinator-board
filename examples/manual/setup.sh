#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOGIN="$(gh api user --jq .login)"
BOARD_REPO="${BOARD_REPO:-$LOGIN/coordinator-board}"
BOARD_ISSUE="${BOARD_ISSUE:-1}"
TASK_REPO="${TASK_REPO:-$BOARD_REPO}"
DIR="$(cd "$(dirname "$0")" && pwd)"

for agent in a b; do
  if [[ $agent == a ]]; then
    id=agent-a
    label="A's Cursor"
    profile=cursor
  else
    id=agent-b
    label="B's Antigravity"
    profile=antigravity
  fi
  cat >"$DIR/agent-$agent.config.json" <<EOF
{
  "boardRepo": "$BOARD_REPO",
  "boardIssue": $BOARD_ISSUE,
  "githubLogin": "$LOGIN",
  "agentId": "$id",
  "agentLabel": "$label",
  "agentProfile": "$profile",
  "projectDir": "$DIR/toy-project",
  "stateDir": "$DIR/state-$agent",
  "allowedSenders": ["$LOGIN"],
  "allowedTaskRepos": ["$TASK_REPO"],
  "approveAll": true,
  "pollSeconds": 10
}
EOF
done

cat <<EOF
Wrote:
  $DIR/agent-a.config.json  (acpx profile: cursor)
  $DIR/agent-b.config.json  (acpx profile: antigravity)

Board: https://github.com/$BOARD_REPO/issues/$BOARD_ISSUE
Task:  https://github.com/$TASK_REPO/issues/2

Prereqs (once):
  npm install
  gh auth status
  npx acpx cursor sessions ensure --name smoke-cursor --cwd "$DIR/toy-project"
  npx acpx antigravity sessions ensure --name smoke-antigravity --cwd "$DIR/toy-project"

Terminal 1:
  node bin/coordinator.mjs run --config $DIR/agent-a.config.json

Terminal 2:
  node bin/coordinator.mjs run --config $DIR/agent-b.config.json

Terminal 3 (kick off a request from A to B):
  node bin/coordinator.mjs send --config $DIR/agent-a.config.json \\
    --task $TASK_REPO#2 --type request --to agent-b --login $LOGIN --body-file - <<'MSG'
Add an exported ping() that returns "pong". Keep health().
MSG

Watch the board issue for Type: result comments. Inspect sessions with:
  npx acpx cursor sessions
  npx acpx antigravity sessions
EOF
