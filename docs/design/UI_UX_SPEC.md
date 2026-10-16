# Canvas UI design

The canvas gives the discussion most of the space. A main graph on the left shows conclusions and the current frontier; a side panel on the right shows the selected node's derivation, body, and history. See [Reasoning mechanism](TREE_MECHANISM_SPEC.md).

## Layout and behavior

- Both graphs flow from top to bottom, with orthogonal connections and measured node geometry.
- The panel follows the current frontier by default. Selecting another node pins it; unpinning resumes following.
- Below 900 px, the panel becomes a drawer. Main content remains navigable.
- Editing happens in place. Node menus expose promotion and deletion; dragging adjacent main nodes previews a merge before committing it.
- Reversible canvas operations offer undo. `Ctrl+Z` undoes, `Ctrl+Shift+Z` redoes, `Escape` closes or cancels, and `F` fits the main canvas when focus permits.
- Less-used controls live in menus: project management, agent connection, language, appearance, and Markdown export.

## Appearance

Light, dark, and system modes use shared semantic CSS variables in `app/ui/theme.css`. Light mode uses a warm off-white canvas and restrained terracotta accents. Dark mode preserves the same semantic roles. Text must satisfy WCAG AA contrast.

| Meaning | Treatment |
| --- | --- |
| Aligned | Green status marker |
| Open / frontier | Blue status marker |
| Revised | Small purple revision marker |
| Rejected | Muted text, dashed treatment, and a recorded reason |
| Key point | Terracotta emphasis |

Colors supplement text labels and symbols. The graph remains readable without relying on color alone. Chinese and English UI strings are maintained together.

## Validation

Browser suites cover both themes, contrast, empty state, fictional replays, narrow viewports, live updates, pinning, edits, merge preview, cancellation, and undo. README images are actual light-mode screenshots of the running app, populated with an invented discussion in isolated demo storage.
