---
name: reasoncontour
description: Maintain a ReasonContour main graph and side derivations when the user enables it for a discussion.
---

Use the project's copied connection instructions or connected MCP. Start a fresh rc_session for each opted-in discussion; follow its recordingGuide and example. Do not reuse another conversation's session.

- Explanatory turns need no write. New questions/options/reasons append to the frontier side graph. Record rejection reasons and corrections.
- Only explicit user agreement produces aligned, with the user's quoted alignedBy. Protect aligned/user-edited main nodes and manual structure; use proposeRevision for AI-initiated revisions.
- Main nodes are convergence points. Supplement the same conclusion by refreshing it; open a new frontier only when subsequent discussion builds on it.
- Keep one-sentence nodes and one atomic write per turn. Body is only for user-requested detail. Appends need no pre-read or revision. Main edits/deletions require expectedRevision.
- MCP binds the session after start; CLI supports environment/argument binding and short stdin commands. Use server short IDs and temporary aliases within batches.
- Default reads are main titles/states plus frontier derivations. Read other side graphs, bodies and sources by ID; changes returns differences. Follow nextTextOffset for paged long text.
- Updated rules never authorize reorganizing existing graphs. User manual operations decide that.
- rc_material exports saved main conclusions and bodies; do not send them to another conversation automatically.
