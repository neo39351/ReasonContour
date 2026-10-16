# Storage and model

UI, CLI and MCP share Service. A project contains `main: {nodes, edges}` (DAG), `side: {[mainId]: {entries, nodes, keyId}}`, revision, monotonic ID counters, proposals, view state, undo/redo and events.

Main states: frontier, tentative, aligned. Side states: open, aligned, rejected, revised. Both aligned states require quoted `alignedBy`; rejected side nodes require a reason. Every side node parent stays within its derivation tree; one root question and at most one key exist per displayed side graph.

Entries are generated from every main predecessor. A retired conclusion entry retains its full `snapshot` and `derivation`. Rendering orders that derivation before the retained conclusion, followed by the receiving tree. This preserves original parents without choosing an arbitrary leaf among competing options. A delete marks the junction `deleted`; a merge retains it without that marker. The receiving key wins, falling back to the earlier key.

Promotion moves the selected path and rejected sibling subtrees. Undecided siblings stay in the original derivation with the necessary ancestor copies; copies use new side IDs and reciprocal `referenceMainId` links. The promoted conclusion keeps the originating side ID. Manual topology edits lock affected structure against automatic rewrites.

## Durable files

Format 4: `projects/p-<encoded-id>/project.json` contains one project and its sessions. `workspace.json` contains notification metadata. `preferences.json` contains language and light/dark/system mode. Prior formats are rejected, never migrated or removed automatically.

A process lock serializes writes. Batches mutate a clone, validate, then replace changed project files through a flushed temporary file and durable `pending.json` journal. A v4 journal is replayed after interruption. This is local-file recovery, not a claim of full power-loss guarantees on every filesystem.

Undo/redo restores content, derivations, keys, locks and proposals in one step while increasing revision. Short IDs are not reused after undo. Event records support difference reads. Only main modifications/deletions require AI expectedRevision checks; append-only side operations serialize without a prior read. Preview runs the same mutation and validation against a read snapshot and never persists it.

## UI and transport

React Flow renders both canvases; ELK supplies vertical positions and orthogonal routes. Geometry uses measured nodes, and layout responses are ignored after the graph changes. Dragging an adjacent node previews the resulting side graph, then commits against the revision captured at gesture start. A concurrent write causes a conflict instead of overwriting it.

Markdown is sanitized with DOMPurify. HTTP binds loopback and checks Host/Origin. There are no accounts, telemetry or automatic cloud backup. Files are plaintext. Session binding protects project routing; it is not a multi-user security boundary.
