# Agent integration

Prefer MCP. Copy the project-specific configuration from the AI menu. CLI is a fallback and accepts JSON from stdin without shell-escaped JSON strings.

```sh
node app/mcp.mjs --project PROJECT_ID --data-dir PATH
node app/cli.mjs --project PROJECT_ID --data-dir PATH session
```

`rc_session start` returns the complete event table, constraints, one write example and minimal context. MCP remembers its session for subsequent calls. For CLI, bind the returned `session.id` once with `REASONCONTOUR_SESSION_ID` or `--session`; project binding also supports `REASONCONTOUR_PROJECT_ID`.

Short CLI subcommands are `session`, `read`, `write`, `material`, `projects`. The `call rc_*` form remains an invocation alias, with only the new data model and tools. No old graph operations are accepted.

## Recording

- Explanations, paraphrases and discussion of RC itself: no write.
- New questions, options or reasons: append to the frontier's side tree.
- User rejects: `setSideState` to `rejected` with `note`.
- User corrects direction: record a `revised` side node and refresh the frontier.
- Explicit user agreement: `aligned` with the exact quoted `alignedBy`; converge the main node when its conclusion is settled. AI estimates remain unapproved.
- Continue on a settled conclusion: create a new frontier and link it.
- Supplement a conclusion: refresh its existing node. Protected AI changes use `proposeRevision`; user actions can edit directly and retain history.
- Replace: `deleteMain` with `replacementId`; the earlier conclusion and its derivation survive as an entry.

Keep nodes to one sentence. Write body only when the user asks. Use one atomic batch per turn, no pre-read for ordinary appends. The server assigns short IDs; `@temporary` names refer to new items within a batch. Keep returned IDs and revision. No node quota is imposed.

`upsertSide`, `setSideState` and `setKey` need no expected revision. Editing/deleting an existing main node needs `expectedRevision`. User-edited structure stays locked against AI rewrites. A changed guide is supplied once to older sessions without reorganizing their graph.

## Reading

Default `rc_read` returns all main titles/states and frontier derivations. Other data is addressed explicitly:

- `scope: side`, `mainId`: another derivation.
- `scope: body`, one `nodeIds` item: a main body, paged using `textOffset` and `nextTextOffset`.
- `scope: sources/source`, `nodeIds`, optionally `sourceId`: source metadata or a paged quotation.
- `scope: changes`, `sinceRevision`: changed nodes/edges/side nodes only; expired cursors require a fresh read.
- `scope: proposal`, `nodeIds`: pending revision.
- `rc_material`: main conclusions and saved bodies in logical order, paged Markdown.

A bound project/session rejects cross-project/session arguments. This is protection against accidental mixing, not an OS sandbox. Pause/close sessions to reject their writes. Only opted-in conversations are recorded. Never send material to other conversations automatically.
