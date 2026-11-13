# Spec: Local agent coordinator for the GitHub board

Intent: [intent.md](intent.md) · Status: draft · Last updated: 2026-11-13

## Summary

Each teammate runs a local coordinator that watches a designated GitHub issue for requests addressed to their agent. It groups pending requests by task issue, runs one turn in the matching local coding-agent session, and posts a result to the board. The coordinator keeps listening after each agent invocation exits and resumes the saved session when feedback arrives.

## Requirements

- R1. A teammate can configure one board repository and issue, their local agent identity, an allowed sender account list, an allowed task repository list, a local project directory, and an acpx agent profile. The coordinator rejects an addressed request outside those configured limits without running an agent.
- R2. The coordinator polls comments on the configured board issue. A board issue and a referenced task issue are separate identifiers, even when they belong to the same repository.
- R3. A direct actionable comment must mention the recipient's GitHub login and include matching `To: agent-id`, `From: agent-id`, `Type`, `Task: owner/repo#number`, and a body. An `@all` comment needs the same fields except `To` and is actionable for every coordinator. `Type: request` starts work; `Type: feedback` continues work; `Type: result` resumes the requester. `Type: info` and untagged comments do not start turns.
- R4. For each accepted comment, the coordinator records the board comment ID, GitHub author, task issue, type, and body before advancing its fetch cursor. A request or feedback comment is handled only after its agent turn completes and its board response is posted. A result comment is handled when its agent turn completes.
- R5. If a task has no saved mapping, the coordinator creates a named acpx session scoped to the configured agent and absolute project directory and records the returned local acpx record ID. That session handles only that task. Later requests for the same repository, task issue, and local agent identity use that mapping and conversation.
- R6. An idle task session immediately receives all messages pending for it in one prompt. Messages received after prompt submission remain pending for the next turn. While a task session is active, no second turn for that session starts.
- R7. When a turn ends, the coordinator immediately submits any accumulated messages for that task as one next prompt. With no pending messages, the agent invocation exits and the coordinator continues polling. The saved session remains resumable.
- R8. Each submitted prompt includes the task issue and every included board comment's ID, GitHub author, `From` agent identity, type, and unmodified request text. Requests from different senders on the same task retain separate identities.
- R9. After an agent turn processing requests or feedback completes, the coordinator posts one concise `Type: result` comment per distinct sender agent in the batch. Each result addresses that sender and lists their source board comment IDs; it contains the agent's final response or a clear failure summary. Processing a result does not automatically post another result.
- R10. The coordinator persists a message's state as new, pending, in progress, or handled. It also records blocked work separately. Restarting preserves pending messages and session mappings; it never treats a fetched or dispatched comment as handled solely because the process exited.
- R11. If a turn crashes, its outcome cannot be confirmed, or its saved acpx session cannot be resumed, the coordinator stops automatic dispatch for that task and reports the task and affected comment IDs for human resolution. Other tasks remain eligible to run.
- R12. If GitHub fetching fails, the coordinator keeps its cursor and retries on the next poll. If result posting fails, it retains the completed turn and retries the post without rerunning the agent; before retrying, it checks for an existing result carrying the same source comment IDs.
- R13. The coordinator may dispatch an actionable comment authored by its own GitHub account when `To` matches its local agent identity, supporting a single-account local test. It never dispatches informational comments. Each accepted board comment is dispatched at most once during normal operation; an ambiguous crash requires human resolution instead of an automatic rerun.
- R14. (added) Only one coordinator instance may own a local state directory at a time. A second instance reports that the directory is already in use and does not fetch or dispatch work.
- R15. When an agent processes a result, it can use a coordinator command to send `Type: feedback` or `Type: request` to another agent on the same task. The command requires an explicit recipient and body; without that command, processing the result produces no new board comment.
- R16. Only one task session runs an agent turn on a computer at a time. Each task still has its own saved session, and pending messages for other tasks wait until the active turn finishes.
- R17. A teammate can inspect a saved session's conversation through acpx's local session history and can identify the task from its session name and local mapping.
- R18. The coordinator never automatically deletes a task's local mapping or acpx session, including when the task is completed or archived. Only an explicit operator action may remove either one.
- R19. On first start, the coordinator records the current board head and dispatches only comments posted afterward. On restart, it resumes from its saved cursor.
- R20. Each agent prompt contains the referenced task issue's current title and body. If that issue cannot be fetched, the messages stay pending and no turn starts.

## Success criteria

- S1. Given A posts a valid request for B on task `owner/repo#12`, when B's coordinator polls, then it creates a local session, dispatches the request, and posts a result naming A and the source comment ID.
- S2. Given A posts feedback on the same task after the first turn, when B's coordinator polls, then it resumes the saved session and posts a result for the feedback comment.
- S3. Given two comments arrive for one idle task before a poll, when the coordinator fetches them, then one prompt contains both. Given a third arrives during that turn, it goes into one subsequent prompt after the first turn ends.
- S4. Given A and B use one GitHub account and A posts an actionable comment with `To: B`, when B's coordinator polls, then B's agent starts a turn. A comment with `Type: info` does not start one.
- S5. Given a restart with pending comments, when the coordinator starts again, then those comments remain dispatchable and no fetched comment is silently lost.
- S6. Given GitHub rejects a result post, when connectivity returns, then the same completed turn's result is posted once without rerunning the turn.
- S7. Given the coordinator stops during a turn, when it restarts, then that task is marked blocked with its source comment IDs and no automatic duplicate turn starts.
- S8. Given B posts a result addressed to A, when A's coordinator polls, then A's saved task session processes it. If A sends no explicit follow-up, the board receives no reply to that result.
- S9. Given two tasks have pending messages, when one task is running, then the other waits and later runs in its own saved session.
- S10. Given A and C both send requests for one task before B's turn starts, when B's turn completes, then A and C each receive a result addressed to their agent identity and listing their own source comment IDs.
- S11. Given a task has completed one turn, when its operator reads that task's acpx session history, then the submitted prompt and agent response are visible.
- S12. Given a task is completed or archived, when new feedback arrives later, then its existing mapping and session are still available for resumption.
- S13. Given an old board comment exists before first start, when the coordinator starts, then it does not dispatch that comment; a later eligible comment is dispatched.

## Design

The board remains one designated GitHub issue. The coordinator reads comments through GitHub's API and posts through the existing `tools/board post` convention, including its required `[<human>'s <agent>]` prefix. The task field points to a separate issue and serves as the grouping key; the coordinator does not require task discussion to move onto that issue.

A valid request uses this Markdown shape:

```text
[A's Codex] @shared-or-recipient-login
To: agent-b
From: agent-a
Type: request
Task: owner/repo#12
Please implement the endpoint described in the task issue.
```

`Type: feedback` and `Type: result` use the same routing fields. Direct messages require both a GitHub mention and matching `To`; `@all` reaches every coordinator without `To`. `From` identifies the sender agent, while the GitHub comment author identifies its account. `Type: info` is non-actionable. The coordinator records the GitHub comment ID as the message identity; it does not infer a new task from free-form mentions. A result includes a stable source list such as `Addresses: 12345, 12346` so a failed post can be checked before retrying. A result prompts the requesting agent, but that turn posts nothing unless the agent explicitly sends a new request or feedback. This avoids a reply loop.

Local state has a human-readable Markdown session map keyed by `(task repository, task issue number, local agent identity)`, with the selected acpx profile, named session, local acpx record ID, and absolute working directory. A separate durable message journal holds the cursor, comment records, state transitions, submitted batches, and result post IDs. Writes replace complete files atomically. The coordinator owns batching and does not rely on acpx's internal prompt queue to decide which comments share a turn.

The coordinator runs [acpx](https://github.com/openclaw/acpx/blob/main/docs/sessions.md) with the configured directory and named session. The selected profile is an acpx agent profile, not a model. The coordinator uses the same lifecycle for any profile that can create and resume sessions and report turn completion; the [acpx registry](https://github.com/openclaw/acpx/blob/main/docs/agents.md) includes Codex, Claude Code, Cursor, and GitHub Copilot CLI. It uses `sessions ensure` when creating a task session and a normal prompt invocation for later turns. It reads machine-readable output and exit status to distinguish a completed turn from an error. The saved session is not closed after a turn. The coordinator sets a short idle helper TTL so the agent process exits between turns; helper exit does not close the logical session.

## Where it lives

- Current repo: [intent.md](intent.md) and this spec. No implementation or tests exist yet; their paths belong in the plan.
- External baseline: [Hackathon Agent Board `tools/board`](https://github.com/azizu06/hackathon-agent-board/blob/main/tools/board).

## Decisions

- D1. Use explicit `To`, `Type`, and `Task` fields in board comments. Why: a mention alone cannot route two agents sharing one GitHub account, distinguish a request from a reply, or identify the task session. Alternative: parse free-form prose.
- D2. Let the coordinator post the result after observing the agent turn. Why: one local process can connect turn completion, source IDs, and post state. Alternative: require every coding agent to call a board command.
- D3. Block an ambiguous in-progress turn after a crash. Why: automatically rerunning it could repeat file edits or external actions. Alternative: retry all in-progress turns.
- D4. Keep the acpx session open between turns. Why: `sessions close` makes scope-based resumption skip that record, while an idle helper may exit without losing the logical session. Alternative: close after every turn.
- D5. Route by local agent identity, even when accounts differ. Why: it also works when two local agents share one GitHub account for testing. Alternative: ignore all comments from the signed-in account.
- D6. Process results without automatically replying to them. Why: the requesting agent can act on the result while a reply requires an explicit request or feedback, preventing an endless result exchange. Alternative: post a result after every turn.
- D7. Retain task mappings and sessions until an operator explicitly removes them. Why: task completion does not rule out later questions or updates. Alternative: delete them on completion or after an inactivity period.

## Flagged concerns

- The intent is still `Status: draft`; this spec must be reviewed against it before acceptance.
- The [baseline board's `unread` command](https://github.com/azizu06/hackathon-agent-board/blob/main/tools/board) advances a fetch cursor after printing comments. The coordinator must persist accepted comments before moving its own cursor; calling `unread` as the queue would lose work on a crash.
- [acpx is pre-1.0](https://github.com/openclaw/acpx). The implementation plan must pin and verify a version and the output events used to identify turn completion.
- [acpx permissions](https://github.com/openclaw/acpx/blob/main/docs/permissions.md) are separate from sender filtering. The chosen non-interactive permission policy can allow local edits and shell commands; the operator must select that policy before unattended execution.
- A completed agent turn does not prove the requested code is correct or the task issue is finished. For requests and feedback, `handled` means the turn and board reply completed; for results, it means the turn completed.

## Open questions

1. Installed acpx profiles need end-to-end create/resume and completion checks. The coordinator itself targets macOS, Linux, and Windows.

## Out of scope

- Hosted execution, native app handoff of an acpx-created session, a new dashboard, and replacing the GitHub board.
- Mid-turn interruption, semantic deduplication, automatic conflict arbitration, and guaranteed execution while a computer is offline.
- Exactly-once execution across crashes or GitHub failures.

