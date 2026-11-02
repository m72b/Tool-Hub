<div align="center">

<pre>
               /$$$$$$$$ /$$$$$$  /$$             /$$$$$$$$                  /$$         /$$                 /$$
              |_____ $$//$$__  $$| $$            |__  $$__/                 | $$        | $$                | $$
 /$$$$$$/$$$$      /$$/|__/  \ $$| $$$$$$$          | $$  /$$$$$$   /$$$$$$ | $$        | $$$$$$$  /$$   /$$| $$$$$$$
| $$_  $$_  $$    /$$/   /$$$$$$/| $$__  $$         | $$ /$$__  $$ /$$__  $$| $$ /$$$$$$| $$__  $$| $$  | $$| $$__  $$
| $$ \ $$ \ $$   /$$/   /$$____/ | $$  \ $$         | $$| $$  \ $$| $$  \ $$| $$|______/| $$  \ $$| $$  | $$| $$  \ $$
| $$ | $$ | $$  /$$/   | $$      | $$  | $$         | $$| $$  | $$| $$  | $$| $$        | $$  | $$| $$  | $$| $$  | $$
| $$ | $$ | $$ /$$/    | $$$$$$$$| $$$$$$$/         | $$|  $$$$$$/|  $$$$$$/| $$        | $$  | $$|  $$$$$$/| $$$$$$$/
|__/ |__/ |__/|__/     |________/|_______/          |__/ \______/  \______/ |__/        |__/  |__/ \______/ |_______/
</pre>

# Tool Hub

**A modular desktop toolbox for files, cleanup, system maintenance, media and PDFs.**
Pick only the tools you need. Everything runs locally on your computer.

[![Version](https://img.shields.io/badge/version-4.0.1-5b8cff)](https://github.com/m72b/Tool-Hub/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-31c07a)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-98a1b2)](#installation)
[![Electron](https://img.shields.io/badge/built%20with-Electron-47848f?logo=electron&logoColor=white)](https://www.electronjs.org/)

[**Download**](https://github.com/m72b/Tool-Hub/releases) ·
[Features](#features) ·
[Add-ons](#add-ons) ·
[Development](#development) ·
[Security](#security) ·
[Report a bug](https://github.com/m72b/Tool-Hub/issues)

<img src="docs/images/pdf-tools.png" alt="Tool Hub with the PDF Tools add-on open" width="860">

</div>

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Add-ons](#add-ons)
- [Screenshots](#screenshots)
- [Development](#development)
- [Project structure](#project-structure)
- [Security](#security)
- [Roadmap](#roadmap)
- [License](#license)

## Features

- **Choose your tools.** Install only what you use from the Tool Library. Tools you leave out are never loaded.
- **Private by design.** Files are processed on your computer and never uploaded.
- **Safe changes.** Deletions go to the Recycle Bin, renames and moves can be undone from the Activity Log, and every write stays inside the folder you picked.
- **Extensible.** Optional features ship as [signed add-ons](#add-ons) that you can add or remove at any time.
- **Yours to style.** Six themes, three corner styles, favourites, a command palette (<kbd>Ctrl</kbd>+<kbd>K</kbd>), and drag-and-drop folders.

### Built-in tools

| Category | Tools |
|---|---|
| **Files** | Batch Renamer · File Organizer · Folder Compare · File Hash Generator · File Attribute Editor · File Date Editor · Directory Tree Export · Folder Sync · File Type Fixer · Archive Tool · Watch Folder · Workflows |
| **Cleanup** | Duplicate Finder · Disk Space Analyzer · Large File Finder · Temporary File Cleaner · Empty Folder Cleaner · Zero-Byte & Shortcut Finder · Secure Delete |
| **System** | Installed Apps Manager¹ · Startup Manager¹ · System Information · Drive Health¹ · Network Toolkit · Port & Process Viewer · Hosts & Environment Editor¹ · File Lock Finder¹ · Disk Benchmark · Scheduled Cleanup¹ |
| **Media** | Image Converter · Image Resizer · Image Privacy & Watermark |
| **Utilities** | Text & Data Utilities (JSON, Base64, UUID, text diff, regex, passwords) |

¹ Windows only. These tools are hidden on other platforms.

### PDF Tools add-on

A free, separately downloaded add-on with 28 PDF tools:

| Group | Tools |
|---|---|
| **Organize** | Merge · Split · Organize pages · Rotate |
| **Optimize** | Compress · Repair · OCR · PDF to PDF/A |
| **Convert** | PDF to Word · PowerPoint · Excel · JPG · Markdown — and Word · PowerPoint · Excel · JPG · HTML to PDF |
| **Edit** | Edit PDF · Watermark · Page numbers · Crop · PDF Forms |
| **Security** | Protect · Unlock · Sign · Redact |
| **Intelligence** | Compare PDF |

Office-to-PDF conversion uses Microsoft Office or [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) when either is installed. OCR uses Windows' built-in text recognition, or [Tesseract](https://github.com/tesseract-ocr/tesseract) on macOS and Linux.

## Installation

1. Download the latest installer from the [**Releases**](https://github.com/m72b/Tool-Hub/releases) page (`m72b-tool-hub-Setup-<version>.exe` on Windows).
2. Run it, and choose whether to install for your account only or for everyone on the PC.
3. On first launch, pick the tools you want. You can change this any time under **Settings → Open Tool Library**.

Tool Hub also has a **portable mode** that keeps its settings next to the app. Turn it on from the Settings panel.

## Add-ons

Add-ons are `.thaddon` files that add new tools without reinstalling the app.

1. Download an add-on (for example `pdf-tools-<version>.thaddon`) from [Releases](https://github.com/m72b/Tool-Hub/releases).
2. Open **Tool Library → Add-ons → Add add-on…** and choose the file.
3. Check who signed it, then click **Install**. Tool Hub restarts with the new tools in the sidebar.

Every add-on is **signed**. Tool Hub verifies an Ed25519 signature and the SHA-256 hash of every file, and refuses add-ons that are tampered with or not signed by a trusted key. Add-ons from other authors must be [checked and authorized by an admin](docs/ADDONS.md#third-party-add-ons) before they are published, and show **"Authorized by …"** when installed. Removing an add-on deletes it completely.

📘 **[Add-on guide](docs/ADDONS.md)** covers installing, building and signing releases, and [writing your own add-on](docs/ADDONS.md#making-your-own-personal-add-on).

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/images/pdf-editor.png" alt="Editing a PDF page"><p align="center"><sub>Edit PDF: add text, images, shapes and drawings</sub></p></td>
    <td width="50%"><img src="docs/images/tool-library.png" alt="Tool Library with installed add-ons"><p align="center"><sub>Tool Library: choose tools and manage signed add-ons</sub></p></td>
  </tr>
</table>

## Development

**Requirements:** [Node.js](https://nodejs.org/) 20 or newer and npm.

```bash
git clone https://github.com/m72b/Tool-Hub.git
cd Tool-Hub
npm install
npm start          # run the app
npm test           # run all test suites
```

| Command | What it does |
|---|---|
| `npm start` | Start Tool Hub from source |
| `npm test` | Run every test suite |
| `npm run build-win` · `build-mac` · `build-linux` | Build an installer into `dist/` |
| `npm run addon:build -- addons/pdf-tools` | Build and sign the PDF Tools add-on |
| `npm run addon:keygen` | Create an add-on signing key |
| `npm run toolhub -- <command>` | Command-line tools: `hash`, `tree`, `duplicates`, `file-types` |

## Project structure

```
main.js                  Electron main process: window, IPC, file-access approval
preload.js               Safe bridge exposed to the window as window.hub
cli.js                   Command-line entry point
src/
  core/                  Tool registry, install state, host, add-on system, safety helpers
  tools/                 One Node module per built-in tool (no Electron imports)
  renderer/              App shell, design system and tool screens
addons/pdf-tools/        PDF Tools add-on source, built into a signed .thaddon
scripts/                 Add-on key generation and build scripts
docs/                    Add-on guide, roadmap and screenshots
test/                    Test suites for every layer
```

Every tool call goes through one checked channel. Before anything runs, the host confirms that the tool exists, runs on this platform and is installed, and that the requested action exists:

```
window → hub.invoke(tool, action, params) → main process → host → tool module
```

## Security

- **No shell injection.** Commands run through `execFile` with argument arrays. User paths reach PowerShell only through environment variables or temporary list files.
- **File access is opt-in.** Tools can only touch files and folders you picked in a dialog. Destructive actions re-check that the target is inside that folder, including symlink targets.
- **Recoverable by default.** Deletions use the Recycle Bin unless you explicitly choose permanent deletion.
- **Locked-down window.** Context isolation, sandboxing and a strict Content Security Policy are on, and navigation and pop-ups are blocked.
- **Signed add-ons.** Add-ons must carry a valid Ed25519 signature from a trusted key, and every file is hash-checked.

Found a security issue? Please [open an issue](https://github.com/m72b/Tool-Hub/issues) and mark it as security related.

## Roadmap

The next major version plans to make every tool an add-on, with tool packs, a signed online catalog and more customization. See **[docs/PLAN-5.0.md](docs/PLAN-5.0.md)**.

## Acknowledgements

The PDF Tools add-on is built on [pdf-lib](https://github.com/Hopding/pdf-lib), [pdf.js](https://github.com/mozilla/pdf.js), [fontkit](https://github.com/Hopding/fontkit) and [qpdf](https://github.com/qpdf/qpdf). Audio tags are read with [music-metadata](https://github.com/Borewit/music-metadata). Third-party licenses are listed in [`addons/pdf-tools/licenses`](addons/pdf-tools/licenses/THIRD-PARTY.md).

## License

Released under the [MIT License](LICENSE). © 2026 m72b
