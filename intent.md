# Intent: Coordinate local coding agents through a shared GitHub board

Author: Vien Nguyen · Date: 2026-11-12 · Status: draft

## Problem

Hackathon teammates use coding agents on separate computers. Agents can post updates and requests to a shared GitHub issue, but someone still needs to notice those requests, open the recipient's coding agent, provide the context, and relay replies. Work stalls when people are not watching their terminals.

For example, A's agent asks B's agent to implement an endpoint. B should start that work in B's own local environment without B manually prompting it. When A sends feedback, B's agent should continue the same conversation rather than start over.

## Desired outcome

Each teammate starts a lightweight, long-running coordinator and selects their coding agent and local project. While the computers are awake and connected, agents can request work from one another through the shared GitHub board without humans manually checking for new work.

The coordinator receives messages, identifies the recipient and task, and starts or resumes the appropriate local agent session. Results return to the board so the requesting agent can continue the exchange.

The MVP should provide this behavior:

- Reuse the Hackathon Agent Board's designated GitHub issue and comment-based communication as the baseline. The board issue is the shared issue where agents post messages; the task issue is the separate issue for the work those messages discuss. Keep their issue numbers distinct.
- Maintain a simple local, human-readable Markdown mapping from repository, task issue ID, and local agent identity to the chosen coding CLI, session ID, and working directory.
- Create a session when a task has no mapping. Reuse the saved session for follow-up requests.
- Run one active turn per task session. A turn is one invocation that processes a submitted batch of messages.
- Let each agent invocation exit after its turn by default. Preserve its session mapping so later messages can resume the conversation.
- Keep the coordinator listening between turns, independently of whether an agent process is running.
- Return a concise response to the board that identifies the requests addressed and their senders. The exact hook or command is defined in spec.md.
- Track new, pending, in-progress, and handled messages separately. Fetching a comment is not equivalent to completing its requested work.

Use this simple dispatch behavior:

| When messages arrive | Coordinator behavior |
| --- | --- |
| Session idle | Immediately submit all currently pending messages for that task together. Do not wait for more messages. |
| Session busy | Accumulate messages locally while the current turn runs. |
| Current turn ends | Immediately submit accumulated messages as one next prompt in the same session. |
| No pending messages | Let the agent process exit and keep listening. |

The coordinator owns the pending batch until dispatch. Once submitted, that batch is fixed; later messages belong to the next turn. Requests from multiple senders on the same task may be handled together, while preserving each request's identity in the response.

A representative successful exchange is: A requests work from B, B starts locally and replies, A provides feedback, and B automatically resumes the same saved session to address it.

## Affected users and systems

- Hackathon teammates running coding agents on their own awake, connected computers.
- Each teammate's local repository, installed coding CLI, and existing authentication.
- The lightweight coordinator, its local session map, and its message-tracking state.
- The shared GitHub board, comments, and referenced task issues.
- acpx as the infrastructure for coding-agent session operations.

## Constraints

- Agent execution must stay in each recipient's local environment. Do not substitute provider-hosted coding agents.
- Use acpx for agent session operations and reuse supported CLI/protocol behavior instead of building a new coding agent.
- Keep the coordinator a lightweight, human-friendly script or CLI wrapper. It should handle communication, tracking, batching, and agent lifecycle, without an additional AI orchestrator.
- Reuse the existing GitHub issue board approach for the MVP. Do not redesign the communication platform.
- The coding agent is configurable. The initial supported agents and adapter behavior must be verified in spec.md.
- Do not require an IDE to remain open or a human to submit the next prompt.
- Persist the session mapping locally. Publishing machine-specific session IDs to GitHub is not required.
- Serialize turns within each task session. Do not launch duplicate workers for the same mapped task.
- Preserve pending work and distinguish failures from successful completion. The recovery policy is defined in spec.md.
- Finishing a turn does not necessarily finish a task. Keep the session and its local mapping after task completion or archival so later feedback can resume the same context; do not remove them automatically.
- Prioritize a working hackathon MVP over sophisticated scheduling or optimization.

## Out of scope

- Hosted agent execution, a fleet-management platform, or a separate dashboard.
- Injecting messages into arbitrary independently opened IDE or interactive terminal sessions.
- Mid-turn interruption or editing a prompt after it has been dispatched.
- Replacing GitHub with a custom mailbox or improving the board's overall information architecture.
- An AI planner that assigns or decomposes work across the team.
- Advanced priority scheduling, semantic deduplication, or automatic conflict arbitration.
- Guaranteed execution when the recipient's computer is asleep or offline.
- A production-grade distributed queue or exactly-once execution guarantee.

## Open questions

These should be answered in spec.md or explicitly carried forward.

1. What minimal message format identifies the task issue, recipient agent, sender, and request being answered? How are actionable feedback and informational replies distinguished to prevent reply loops?
2. Which coding agents and operating systems are supported first? What acpx version and operations implement create, resume, completion detection, and process shutdown while retaining session history?
3. Does each teammate use a separate GitHub account, or must multiple agent identities share one account? How should the baseline board's own-account filtering behave?
4. How are the Markdown session map and pending-message state stored and updated safely? What happens on restart or a partially completed turn?
5. How does the agent publish its response: a coordinator command, an end-of-turn hook, or coordinator handling of a structured result? How is a successful post recorded?
6. How many different task sessions may run simultaneously on one computer? Do they share a checkout or use separate worktrees?
7. What are the polling interval and first-start behavior for older board comments?
8. What happens on GitHub errors, agent crashes, permission prompts, unavailable saved sessions, or failed reply posting? Which cases retry automatically and which need human attention?
9. What minimal configuration limits accepted senders, repositories, and local execution permissions?
10. When does a task become complete or archived, and how does later feedback reopen it?

## References

- [Original walkthrough on Notion](https://marvelous-relative-5de.notion.site/hack). User-provided reference; its contents were not accessible during the initial review.
- [Hackathon Agent Board repository](https://github.com/azizu06/hackathon-agent-board). Baseline GitHub communication script and agent instructions.
- [Farsight example message board, issue #24](https://github.com/azizu06/farsight/issues/24). Example of agents coordinating through issue comments.
- [acpx repository](https://github.com/openclaw/acpx). Selected infrastructure for agent sessions.
- [acpx session documentation](https://github.com/openclaw/acpx/blob/main/docs/sessions.md). Reference for session persistence, queueing, and lifecycle behavior to verify during specification.

## Amendments

