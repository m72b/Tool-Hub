# m72b Tool Hub

A modular Electron desktop application containing 33 tools across files, cleanup, system, media and utility workflows, plus optional signed add-ons such as **PDF Tools**. On first launch you choose which tools to install; uninstalled tools are never loaded into memory and register no IPC handlers.

## Running

```bash
npm install
npm start
npm test
npm run build-win
npm run addon:build -- addons/pdf-tools
```

## Architecture

```
main.js                 Electron shell, window management, IPC surface
preload.js              contextBridge API exposed as window.hub
src/core/safe.js        Path/host validation, execFile wrappers, command-line parsing
src/core/walk.js        Filesystem walker with symlink-loop and depth limits
src/core/registry.js    Manifest of every tool
src/core/store.js       Install-state persistence (userData/installed-tools.json)
src/core/host.js        Lazy tool loading, gating, IPC dispatch
src/core/imageio.js     Shared image list/read/write
src/core/addons.js      Add-on install/remove, trusted signing keys
src/core/addon-format.js  Signed .thaddon package format (Ed25519)
addons/pdf-tools/       PDF Tools add-on source (built into a .thaddon)
scripts/                addon:keygen and addon:build
src/tools/*.js          One module per tool, pure Node, no Electron imports
src/renderer/           Hub shell, design system, tool views
test/                   Node test suites for every layer
```

Tool calls travel over a single IPC channel. The host validates that the tool exists, is supported on the current platform, is installed, and that the action exists before anything runs.

```
renderer -> hub.invoke(toolId, action, params) -> tool:invoke -> host -> tool module
```

### Built-in tools and add-ons

Built-in tools are enabled and disabled locally in the Tool Library: an uninstalled tool's module is never required, so it occupies no memory and exposes no handlers.

Larger optional features ship as **add-ons**: separate `.thaddon` files published on the GitHub releases page and added with **Tool Library → Add add-on…**. Add-ons are signed with Ed25519 and Tool Hub refuses any add-on that is not signed by a trusted key, so a tampered or fake add-on cannot be installed. See [docs/ADDONS.md](docs/ADDONS.md) for installing add-ons, signing releases, and writing your own personal add-ons.

## Tools

**Files** - Batch Renamer, File Organizer, Folder Compare, File Hash Generator, File Attribute Editor, File Date Editor, Directory Tree Export, Folder Sync, File Type Fixer, Archive Tool, Watch Folder, Workflows

**Cleanup** - Duplicate Finder, Disk Space Analyzer, Large File Finder, Temporary File Cleaner, Empty Folder Cleaner, Zero-Byte & Shortcut Finder, Secure Delete

**System** - Installed Apps Manager, Startup Manager, System Information, Drive Health, Network Toolkit, Port & Process Viewer, Hosts & Environment Editor, File Lock Finder, Disk Benchmark, Scheduled Cleanup

**Media** - Image Converter, Image Resizer, Image Privacy & Watermark

**Utilities** - Text & Data Utilities

**PDF Tools add-on** - Merge, Split, Organize, Rotate, Compress, Repair, OCR, PDF/A, PDF to Word / PowerPoint / Excel / JPG / Markdown, Word / PowerPoint / Excel / JPG / HTML to PDF, Edit, Watermark, Page numbers, Crop, Forms, Sign, Protect, Unlock, Redact and Compare. Everything runs locally; Office-to-PDF conversion uses Microsoft Office or LibreOffice when installed.

Batch Renamer and File Organizer are core tools and are always installed. Installed Apps Manager, Startup Manager and Drive Health are Windows-only and are hidden on other platforms.

## Security model

- No user input is ever interpolated into a shell string. `safe.run` uses `execFile` with `shell: false` and an argument array.
- PowerShell receives user paths through environment variables or temp list files, never through string concatenation.
- Hostnames are validated against a strict pattern before reaching argv, so ping and traceroute cannot be used for command injection.
- Every destructive operation validates that the target resolves inside the folder the user selected, including symlink targets.
- Deletions go to the Recycle Bin via `shell.trashItem` unless permanent deletion is explicitly requested.
- Uninstall commands are cached from the registry listing; the renderer cannot supply a command to execute.
- The window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. Navigation and new windows are blocked.
- Renderer CSP is `default-src 'none'` with scripts limited to `'self'` and signed add-ons served from `toolhub-addon://`.
- Add-ons install only when their Ed25519 signature verifies against a trusted key, and every file is checked against its signed SHA-256.

## Dependencies

The app uses `music-metadata` to read audio tags for Batch Renamer. The PDF Tools add-on bundles pdf-lib, pdf.js, fontkit and qpdf (see `addons/pdf-tools/licenses`). Other tools use Node builtins. Image encoding runs through Chromium canvas, and Windows hardware data comes from PowerShell and `reg.exe`; no native modules need to be compiled.

## Testing

The `test/` folder contains test files grouped into eight suites. They cover path traversal and command-injection defences, the filesystem walker, install-state persistence, tool backends, view registration for all built-in tools, headless execution of every view's result-rendering path, add-on signing and installation, and the PDF Tools add-on backend.
