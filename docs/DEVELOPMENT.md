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

## Windows installer and releases

On Windows x64, run `npm ci` followed by `npm run dist:win`. This builds the frontend and native host, collects only the required server modules and full production dependency licenses, bundles Node.js 24.18.1, and creates an Inno Setup 6.7.3 installer plus SHA-256 checksums in `release/`. Build tools and downloads are cached in `.desktop-deps/` and excluded from Git and source exports.

Node downloads are checked against the official release's SHA-256 list; the Inno installer and Microsoft WebView2 bootstrapper require valid publisher signatures. The compiler is installed in the local build cache. The first build requires internet access. `npm run build:desktop` builds only the host.

The setup runs per user without elevation, installs into `%LOCALAPPDATA%\Programs\ReasonContour`, and creates a Start menu shortcut. A desktop shortcut is optional. Existing WebView2 installations are reused; otherwise the Microsoft bootstrapper installs the Evergreen runtime using the internet. No Node.js installation, npm, source checkout, or `node_modules/` is required on the user's machine. Windows 10 build 19041+ and Windows 11 x64 are supported. The installer is unsigned unless the maintainer adds code signing.

An `installed.json` marker selects installed mode. The host prefers its bundled `runtime/node.exe` and stores project data and WebView2 profiles under `%LOCALAPPDATA%\ReasonContour`. `REASONCONTOUR_NODE` and `REASONCONTOUR_DATA_DIR` remain explicit overrides. Source checkouts retain their existing data locations. Upgrades and uninstallation do not delete user data. Copying source-checkout data is a separate manual operation; old storage formats are not migrated.

`npm run test:installer` silently installs into an isolated path, launches the real WebView2 host without Node on PATH, verifies bundled Node and installed data routing, exercises CLI, reinstalls, uninstalls, and checks retained user-created files. It refuses to overwrite an existing user's registered installation. Run it in CI or a clean Windows account. The desktop self-test uses isolated data, never existing projects.

`.github/workflows/release.yml` runs on version tags and manual dispatch. It builds and tests the installer on Windows. Manual runs upload an Actions artifact; tags matching `package.json` publish the installer and checksums as a GitHub Release only after successful tests. Edit `docs/RELEASE_NOTES.md`, commit, and push `v<package version>` to release.

## Source export

`npm run export:source -- /absolute/new/destination` copies an explicit allowlist into a new directory and writes `SOURCE_MANIFEST.json` with SHA-256 hashes. It excludes project data, local settings, credentials, caches, dependencies, and build output. The manifest describes the source snapshot at export time.

README images are actual app screenshots in `docs/assets/`, using an invented team knowledge-base discussion. Run `npm run build` and `npm run capture:readme` to reproduce them with Playwright Chromium; `REASONCONTOUR_CHROMIUM` can select an installed browser. Capture uses isolated demo storage and never reads existing projects.

CI runs unit tests and builds on Windows/Linux with Node.js 22/24, and browser checks on Linux. Check the repository's Actions page for actual remote results.
