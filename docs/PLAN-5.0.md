# Plan: Tool Hub 5.0 — everything is an add-on

**Status:** proposal only, not started. Nothing here is implemented until it is approved.

## Goal

Ship Tool Hub as a small core shell. Every tool — including the ones built in today — becomes a signed `.thaddon`, so each person installs exactly the tools they want, and the app can be shaped around them.

## Where the size really is (measured on 4.0.0)

| Part | Installed size | Can add-ons remove it? |
|---|---|---|
| Electron runtime (`Tool Hub.exe`, Chromium DLLs, ICU data, V8 snapshots) | ~210 MB | No — every Electron app needs it |
| Chromium language packs (`locales/`, 55 languages) | 39 MB | No, but most can be **dropped at build time** |
| Chromium license file | 9 MB | No (must ship) |
| **All Tool Hub code + its libraries** (`app.asar`) | **1.5 MB** | Yes |
| PDF Tools add-on (already separate) | 13 MB | Already optional |

**Honest takeaway:** moving the 33 built-in tools into add-ons saves about 1 MB on disk. Its real value is customization, faster startup (nothing loads that you did not install) and independent tool updates. The meaningful size cuts come from the build itself:

1. **Keep only needed languages** (`electronLanguages: ["en-US", "ar"]` in the build config): about −37 MB installed.
2. **Maximum installer compression** (`compression: "maximum"`): a smaller download, same installed size.
3. **Move `music-metadata` into a Media add-on** (the only runtime dependency, ~1 MB with its sub-packages).

Together, this brings the install from ~260 MB to roughly **220 MB**, and the download from ~79 MB to an estimated **70 MB**. Going lower would mean leaving Electron (for example, a WebView2-based shell such as Tauri). That is a full rewrite, so it is listed as a future option, not part of 5.0.

## Proposed design

### 1. Core shell (what the installer contains)

- Window, sidebar, themes and appearance, command palette, Activity Log, settings, portable mode
- Add-on manager, signature checks, trusted keys
- Shared helpers add-ons rely on (`safe`, `walk`, `imageio`, UI kit `ui.js`), exposed as a **versioned add-on API** (`ctx.lib` in the main process, `window.UI` / `window.Hub` in the window)
- A first-run screen that installs add-ons, plus a small built-in **Starter pack** so the app is never empty offline

### 2. Tool packs (each a signed `.thaddon`)

| Pack | Tools |
|---|---|
| Files | Batch Renamer, File Organizer, Folder Compare, Hash, Attributes, Dates, Tree Export, Folder Sync, File Type Fixer, Archive, Watch Folder, Workflows |
| Cleanup | Duplicates, Disk Analyzer, Large Files, Temp Cleaner, Empty Folders, Zero-Byte & Shortcuts, Secure Delete |
| System (Windows) | Apps Manager, Startup Manager, System Info, Drive Health, Network, Ports, Hosts & Environment, File Locks, Disk Benchmark, Scheduled Cleanup |
| Media | Image Converter, Image Resizer, Image Privacy (+ `music-metadata` for audio tags) |
| Utilities | Text & Data Utilities |
| PDF | PDF Tools (exists today) |

Packs keep the number of downloads and signatures manageable. Inside each pack, tools can still be shown or hidden one by one.

**Starter pack (bundled in the installer):** Batch Renamer, File Organizer and Utilities, so a first launch without internet still works. They update like any other add-on.

### 3. Getting add-ons

- **Built-in catalog:** the app reads a signed `catalog.json` from the GitHub release. It lists the packs, versions, sizes, download URLs and SHA-256 hashes. The catalog is signed with the same release key, so a hijacked download link cannot slip in a fake add-on.
- **One-click install** from the catalog, with a progress bar, plus the existing **Add add-on…** button for offline or third-party files.
- **Updates:** the app checks the catalog (at most daily, and only if allowed in settings) and offers updates per pack. Settings include a "Never connect to the internet" switch, with manual files only.
- **Third-party add-ons:** authors submit their add-on for review. An admin checks and authorizes it, and it is published in the catalog with "Authorized by …".

### 4. Customization

- First-run picker becomes "Choose your packs", with a live total of the download size
- Sidebar: drag to reorder, rename groups, hide tools, pin favourites (favourites exist already)
- Per-tool defaults (for example a default output folder) saved per add-on
- Themes can also ship as add-ons (CSS only, so they need no code review)

### 5. Migration from 4.x

- The first 5.0 launch reads the existing `installed-tools.json` and installs the matching packs automatically (from the bundled copies or the catalog). Users keep the tools they had.
- Settings, favourites, history and the PDF add-on carry over unchanged. The add-on folder location stays the same.
- Add-ons built for 4.x keep working: the add-on API stays compatible, and `minAppVersion` is checked as today.

### 6. Security

- Same Ed25519 signatures plus a signed catalog, and every download is hash-checked before install
- A per-add-on permission summary shown at install time (for example "runs PowerShell", "uses the network", "contains native programs"), taken from the manifest and checked during admin review
- Key rotation: the app supports more than one official key, so a replacement key can be added in one release before the old one is retired

## Work breakdown (estimated)

| Step | Work |
|---|---|
| 1 | Build-size wins: languages, compression (quick and safe; could even ship in a 4.x update) |
| 2 | Freeze and document the add-on API (`ctx.lib`, `window.UI`, `window.Hub`), with version numbers |
| 3 | Move tool code into `addons/<pack>/` folders; update tests to run against the packs |
| 4 | Signed catalog format and generator script; catalog download and install in the app |
| 5 | First-run pack picker and migration from 4.x |
| 6 | Sidebar customization |
| 7 | Permission summaries in manifests, the install dialog and admin review |
| 8 | Release pipeline: one command builds the app, every pack and the catalog, then signs everything |

## Decisions needed before starting

1. **Packs or single tools as downloads?** Recommended: packs, with per-tool show/hide inside.
2. **Bundle a Starter pack in the installer?** Recommended: yes (Renamer, Organizer, Utilities), so the app works offline right away.
3. **Allow the app to go online** for the catalog and updates (opt-out), or keep it strictly manual?
4. **Languages to keep** in the build (for example English + Arabic).
5. **Ship the size quick wins (step 1) in a 4.x update first?**
