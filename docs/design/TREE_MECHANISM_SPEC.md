# Reasoning graph mechanism

The main graph records convergence points and active questions. Each main node owns a side derivation tree. See [Architecture](../ARCHITECTURE.md) for storage and transport details, and [UI design](UI_UX_SPEC.md) for presentation.

## Main graph

- Main edges mean “therefore” or “next.” The graph is a directed acyclic graph; forks and joins are supported.
- A settled title is a self-contained conclusion. An active frontier names the question being discussed and may include a tentative summary.
- States are `frontier`, `tentative`, and `aligned`.
- Supplementing a conclusion refreshes its existing node and retains the previous version. A new question that builds on a conclusion starts a new frontier.

## Side derivation

- A question branches into alternatives. Follow-up questions can deepen an alternative.
- States are `open`, `aligned`, `rejected`, and `revised`. Rejected options remain visible with their rejection reasons.
- Each displayed derivation has one root question and at most one key point. A key point highlights the reasoning that changed the discussion's direction.
- Entries connect predecessor conclusions to the derivation. A removed or merged conclusion retains its snapshot and complete derivation as an entry.
- Sources, optional Markdown bodies, turn numbers, and change history preserve context without overcrowding the main graph.

## Recording a discussion

| Discussion event | Write behavior |
| --- | --- |
| Explanation or paraphrase | No write required |
| New question, option, or reason | Append to the frontier's side tree |
| User rejects an option | Mark it `rejected` and record the reason |
| User corrects direction | Record a `revised` side node and refresh the frontier |
| Explicit user agreement | Set `aligned` with a quoted `alignedBy`; converge the main node when settled |
| Follow-up builds on a settled conclusion | Create and link a new frontier |
| AI needs to change protected content | Submit a revision proposal |

Only explicit user agreement can establish `aligned`. An unchallenged AI estimate remains unapproved. AI cannot silently rewrite aligned conclusions, user-edited main content, or protected manual structure.

Use one atomic batch per discussion turn. Main edits and deletions require an expected revision; ordinary append operations do not require a pre-read. MCP binds the project and session; CLI supports explicit binding. See [Agent integration](../AI_USAGE.md).

## Manual control

- **Promote:** move a side path into a main conclusion; retain rejected siblings and references to undecided branches.
- **Merge:** combine adjacent main nodes while retaining both derivations. The receiving key wins, with a fallback to the earlier key.
- **Delete:** retain a conclusion and its derivation as an entry in the receiving graph.
- **Edit:** change a title directly; user-edited content is protected from AI rewrites.
- **Undo / redo:** restore content and structure atomically. Revisions continue increasing and identifiers are not reused.

Concurrent writes must fail on a revision conflict rather than overwrite manual changes.

## Public examples

The README screenshots show the running application with an invented team knowledge-base discussion. Test fixtures use a fictional workspace redesign and a generic cloud-migration scenario; they exercise convergence, rejection, correction, retained derivations, and unresolved frontiers without shipping local project data or source conversations.
