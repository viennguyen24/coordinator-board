# Plan: Local agent coordinator

Spec: [spec.md](spec.md) · Status: accepted · Date: 2026-11-13

## Approach

Build a small Node.js CLI around `gh` and acpx. Keep one JSON state file authoritative and generate a Markdown session map from it. Test each observable behavior at the CLI boundary with controlled external commands, using a red-green loop.

## Files that change

- `spec.md`: record the confirmed routing and startup behavior (R3, R19, R20).
- `package.json`, `package-lock.json`, `.gitignore`: pin acpx 0.22.0, define test command, ignore local state (R1, R5).
- `bin/coordinator.mjs`, `src/*.mjs`: CLI, GitHub and acpx adapters, state, dispatch, replies, recovery (R1–R20).
- `test/*.test.mjs`, `test/fixtures/*.mjs`: CLI-level tests with controlled GitHub and acpx commands (R1–R20).
- `README.md`, `.github/workflows/test.yml`: setup, commands, and tests on macOS, Linux, Windows (R1, R17).

## Order of work

1. Add the CLI package and a failing routing test; implement config and message parsing.
2. Add failing polling and state tests; implement the first-start cursor, durable journal, and Markdown map.
3. Add failing session and batching tests; implement acpx create/resume, one active host turn, and task issue context.
4. Add failing reply and recovery tests; implement result delivery, explicit send, post retry, and blocked-turn resolution.
5. Add documentation and cross-platform test workflow; run the whole suite and a local smoke test when credentials and a disposable board are available.

## Risks

- A crash after dispatch can leave an uncertain agent outcome. Block that task for operator resolution instead of automatically repeating edits.
- A GitHub post can succeed before its acknowledgement reaches the coordinator. Give each result a stable delivery ID and check the board before retrying.
- Two local coordinators can run on one computer. Use a host-wide turn lock as well as an instance lock for each state directory.
- acpx profiles vary. Keep the profile configurable, pin acpx, and report unsupported session behavior as a blocked task.

## Proof

- R1–R3, R13: `node --test test/routing.test.mjs`
- R2, R4, R10, R12, R19: `node --test test/polling.test.mjs`
- R5–R8, R16–R18, R20: `node --test test/sessions.test.mjs`
- R9, R11, R12, R15: `node --test test/replies.test.mjs`
- R14: `node --test test/locks.test.mjs`
- All requirements: `npm test` on macOS, Linux, and Windows.

## Deviations

None.
