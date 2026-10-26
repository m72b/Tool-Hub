# m72b Tool Hub

A modular Electron desktop application containing 17 file, cleanup and system tools. On first launch you choose which tools to install; uninstalled tools are never loaded into memory and register no IPC handlers.

## Running

```bash
npm install
npm start
npm test
npm run build-win
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
src/tools/*.js          One module per tool, pure Node, no Electron imports
src/renderer/           Hub shell, design system, tool views
test/                   Node test suites for every layer
```

Tool calls travel over a single IPC channel. The host validates that the tool exists, is supported on the current platform, is installed, and that the action exists before anything runs.

```
renderer -> hub.invoke(toolId, action, params) -> tool:invoke -> host -> tool module
```

### About "downloading" tools

Tools are enabled and disabled locally rather than fetched from a server, because there is no release endpoint to fetch from. The difference is real rather than cosmetic: an uninstalled tool's module is never required, so it occupies no memory and exposes no handlers. `src/core/host.js` is where a remote fetch would slot in if you later publish tool bundles.

## Tools

**Files** - Batch Renamer, File Organizer, Folder Compare, File Hash Generator, File Attribute Editor, File Date Editor

**Cleanup** - Duplicate Finder, Disk Space Analyzer, Large File Finder, Temporary File Cleaner

**System** - Installed Apps Manager, Startup Manager, System Information, Drive Health, Network Toolkit

**Media** - Image Converter, Image Resizer

Batch Renamer and File Organizer are core tools and are always installed. Installed Apps Manager, Startup Manager and Drive Health are Windows-only and are hidden on other platforms.

## Security model

- No user input is ever interpolated into a shell string. `safe.run` uses `execFile` with `shell: false` and an argument array.
- PowerShell receives user paths through environment variables or temp list files, never through string concatenation.
- Hostnames are validated against a strict pattern before reaching argv, so ping and traceroute cannot be used for command injection.
- Every destructive operation validates that the target resolves inside the folder the user selected, including symlink targets.
- Deletions go to the Recycle Bin via `shell.trashItem` unless permanent deletion is explicitly requested.
- Uninstall commands are cached from the registry listing; the renderer cannot supply a command to execute.
- The window runs with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`. Navigation and new windows are blocked.
- Renderer CSP is `default-src 'none'` with scripts limited to `'self'`.

## Dependencies

The app uses `music-metadata` to read audio tags for Batch Renamer. Other tools use Node builtins. Image encoding runs through Chromium canvas, and Windows hardware data comes from PowerShell and `reg.exe`; no native modules need to be compiled.

## Testing

`npm test` runs six suites covering path traversal and command-injection defences, the filesystem walker, install-state persistence, every tool backend, view registration for all 17 tools, and headless execution of every view's result-rendering path.
