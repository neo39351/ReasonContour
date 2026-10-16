# Third-party components

ReasonContour source is MIT licensed. Dependencies retain their licenses; `package-lock.json` records resolved versions and license metadata.

Runtime components include React/React DOM (MIT), React Flow (MIT), ELK.js (EPL-2.0 OR GPL-3.0-or-later), Marked (MIT), and DOMPurify (Apache-2.0 OR MPL-2.0). Development tools include Vite and Playwright under their respective licenses. Consult installed packages for full notices when redistributing compiled bundles.

The optional Windows build downloads the Microsoft WebView2 SDK, under its separate license. This source export contains no Microsoft binary. Desktop binary redistribution must preserve the SDK license alongside its DLLs. WebView2 Runtime and Node.js are separate prerequisites, not bundled here.

Generated Windows installers bundle Node.js with its full LICENSE text, WebView2 SDK DLLs with their license, and complete license / notice files for the production JavaScript dependency tree under `licenses/`. The WebView2 bootstrapper is included and installs Microsoft's shared Evergreen Runtime only when needed. Node.js and WebView2 binaries are not committed to this source repository. Inno Setup is a build tool; its compiler is not shipped as part of the application.
