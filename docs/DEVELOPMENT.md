# Development

Requires Node.js >=22.12. Install pinned dependencies with `npm ci`.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:appearance
npm run test:manual
npm run test:live
```

Unit and integration tests cover model invariants, batch atomicity, protected content, side transfers, manual operations, undo/redo, optimistic conflicts, storage recovery, format rejection, session binding, CLI/MCP, HTTP, layout, and discussion replays.

Browser checks cover light/dark themes, empty and populated canvases, narrow windows, text contrast, live updates, pinning, language and system appearance, editing, promotion, deletion, merge preview, cancellation, and undo. `test:appearance` runs the visual suite; `test:drag` runs the manual browser suite.

Tests use isolated `.test-data/` directories. `REASONCONTOUR_CHROMIUM` can point to a browser executable; otherwise Playwright's installed Chromium is used. `REASONCONTOUR_QA_DIR` chooses screenshot output, default `work/ui-qa`.

The fictional workspace replay spans 19 turns; a generic cloud-migration replay spans 14. They report JSON argument/result character counts, including the initial session guide, and enforce a mean of at most 1000 characters per discussion turn. User edits are replayed through the user action path; AI estimates remain unapproved until explicitly accepted.

Product rules are documented in `docs/design/`. Preserve the separation between AI proposals and explicit user agreement.

## Optional Windows host

Build with `desktop/build.ps1` using the .NET Framework compiler. The script downloads the WebView2 SDK and builds a host for the same local service. Node.js and WebView2 Runtime are separate prerequisites. Browser usage does not require the desktop host.

## Source export

`npm run export:source -- /absolute/new/destination` copies an explicit allowlist into a new directory and writes `SOURCE_MANIFEST.json` with SHA-256 hashes. It excludes project data, local settings, credentials, caches, dependencies, and build output. The manifest describes the source snapshot at export time.

README images are actual app screenshots in `docs/assets/`, using an invented team knowledge-base discussion. Run `npm run build` and `npm run capture:readme` to reproduce them with Playwright Chromium; `REASONCONTOUR_CHROMIUM` can select an installed browser. Capture uses isolated demo storage and never reads existing projects.

CI runs unit tests and builds on Windows/Linux with Node.js 22/24, and browser checks on Linux. Check the repository's Actions page for actual remote results.
