# Tool Hub add-ons

Every tool in Tool Hub lives in an add-on: a signed `.thaddon` file for each section (Starter, Files, Cleanup, System, Media, PDF, Clipboard, Capture, Fonts, Event Log and Devices). Users download only the sections they want, from the Tool Library, and can remove them again. [See what each section contains](SECTIONS.md).

- [For users: installing an add-on](#installing-an-add-on)
- [Why add-ons are signed](#why-add-ons-are-signed)
- [Building and signing the official add-ons](#building-and-signing-the-official-add-ons)
- [Third-party add-ons](#third-party-add-ons)
- [Making your own personal add-on](#making-your-own-personal-add-on)
- [Add-on reference](#add-on-reference)

---

## Installing an add-on

**One click:** open **Settings ⬡ → Open Tool Library** and click **Download** on a section. Tool Hub restarts with its tools in the sidebar. Use **Update** when a newer version appears.

**From a file (no internet on the PC):**

1. Download the `.thaddon` file from the [GitHub releases](https://github.com/m72b/Tool-Hub/releases) page.
2. In Tool Hub open **Settings ⬡ → Open Tool Library**.
3. Under **Sections**, click **Add add-on…** and choose the file.
4. Check the name, version and **Signed by** line in the confirmation, then click **Install add-on**. Tool Hub restarts and the add-on's tools appear in the sidebar.

A newer `.thaddon` file replaces the installed version. To uninstall, click **Remove** on the section's card; if it came with the app, it will not come back until you add it again. Your own files are never touched by installing or removing an add-on.

Add-ons are stored in Tool Hub's data folder (`%APPDATA%\tool-hub\addons` on Windows), separate from the app, so reinstalling or updating Tool Hub keeps them.

## Why add-ons are signed

An add-on runs with the same access to your files as Tool Hub itself. To make sure nobody can hand you a fake "PDF Tools" that steals or damages files, **Tool Hub only installs add-ons signed with a trusted key**:

- Every add-on is signed with an **Ed25519** private key. The signature covers the add-on's manifest and the SHA-256 hash of every file inside, so any change to the package after signing is detected and the install is refused.
- Tool Hub ships with one built-in trusted key: the official m72b release key. Add-ons from the official releases install without any extra steps.
- Add-ons from other authors are [checked and authorized by an admin](#third-party-add-ons) before they are signed with the official key.
- For developing and testing your own add-ons, you can trust a **personal key** on your own devices under **Tool Library → Add-ons → Trusted keys**. The install dialog always shows which key signed an add-on, and warns when it is not the official one.
- Add-ons declare which Tool Hub versions they work with (`minAppVersion` / `maxAppVersion`); incompatible ones are refused instead of failing at runtime.

Only trust keys from people you know. Trusting a key means trusting every add-on that key signs.

## Building and signing the official add-ons

Maintainers only. You need Node.js and the repository's dev dependencies (`npm install`).

```bash
# one time: create the release key (stored outside the repository)
npm run addon:keygen

# build and sign every section, plus the signed catalog -> dist/addons/
npm run addons
```

`addon:keygen` writes the private key to `~/.toolhub/addon-signing-key.pem` and prints the public key. The public key goes into [`src/core/addon-trust.json`](../src/core/addon-trust.json) so new app builds trust it. **Never commit the private key**, and back it up somewhere safe — if it is lost, existing installs can no longer verify updates signed with a new key until users update Tool Hub.

The build signs with `~/.toolhub/addon-signing-key.pem` by default; use `--key <file>` or the `TOOLHUB_ADDON_KEY` environment variable to choose another key, and `--out <folder>` to change where the file is written.

Release checklist:

1. Bump `version` in the add-on's `addon.json` (and `minAppVersion` if it needs a newer app).
2. `npm test`
3. `npm run build-win` (runs `npm run addons` first; Starter is included in the installer from `dist/bundled`)
4. Create a GitHub release tagged `v<app version>`, and upload the installer plus **everything in `dist/addons`**, including `catalog.json`. The app reads the catalog from the latest release, so sections appear in the Tool Library as soon as it is published. Mark it as the latest release.

## Third-party add-ons

Add-ons written by anyone other than the Tool Hub maintainer **must be checked and authorized by a Tool Hub admin** before they are published for everyone.

1. Build and test your add-on on your own computer (see [Making your own personal add-on](#making-your-own-personal-add-on)).
2. [Open an issue](https://github.com/m72b/Tool-Hub/issues) asking for review, and attach your add-on's source folder or `.thaddon` file.
3. An admin reviews the code and what it can access. If it is approved, the admin signs it with the official release key.
4. The approved add-on is published, and every Tool Hub install shows **"Authorized by …"** with the admin's name in the install dialog and on the add-on's card.

The "Authorized by" name is stored inside the signature, so it cannot be added or changed without invalidating the file. An add-on without official authorization only installs on devices where the user has deliberately trusted its author's key.

## Making your own personal add-on

You can extend Tool Hub with your own tools without changing the app.

### 1. Create a signing key

```bash
npm run addon:keygen -- --out C:\keys\my-addon-key.pem
```

This prints your **public key** (one base64 line) and a fingerprint. Keep the `.pem` file private.

### 2. Trust your key in Tool Hub

Open **Tool Library → Add-ons → Trusted keys**, enter a name (for example "My add-ons"), paste the public key and click **Trust this key**. This is for your own devices while you develop. To share the add-on with other people, submit it for [admin authorization](#third-party-add-ons).

### 3. Write the add-on

Create a folder with this layout:

```
my-addon/
  addon.json          manifest (required)
  main/index.js       main-process code: your tool's actions
  ui/view.js          renderer code: your tool's screen
  ui/style.css        optional styles
  build.js            optional build step (copy vendor files, download binaries…)
```

`addon.json`:

```json
{
  "id": "word-counter",
  "name": "Word Counter",
  "version": "1.0.0",
  "description": "Counts words in text files.",
  "minAppVersion": "4.0.0",
  "tools": [
    {
      "id": "word-counter",
      "name": "Word Counter",
      "category": "Utilities",
      "icon": "WC",
      "description": "Count the words in a text file.",
      "module": "main/index.js"
    }
  ],
  "scripts": ["ui/view.js"],
  "styles": []
}
```

`main/index.js` exports the tool's actions. Each action receives the parameters sent by your screen and a context object. `ctx.lib` gives you Tool Hub's helpers (`safe`, `walk`, `imageio`; also available as `globalThis.toolHubLib`), and `ctx.invokeTool(toolId, action, params)` calls another tool, returning `{ ok, data }` or `{ ok: false, error }`. A tool that runs only in the window can leave out `module`.

```js
const fs = require('fs');

module.exports = {
  actions: {
    async count(params, ctx) {
      const file = ctx.lib.safe.existingFile(params.path);   // throws a friendly error if missing
      const text = fs.readFileSync(file, 'utf8');
      return { words: (text.match(/\S+/g) || []).length };
    },
  },
};
```

`ui/view.js` registers a screen for the tool id, using Tool Hub's UI helpers:

```js
(function () {
  const { h, toolShell } = window.UI;
  window.Hub.registerView('word-counter', {
    render(api) {
      return toolShell({
        title: 'Word Counter',
        description: 'Count the words in a text file.',
        action: 'count',
        runLabel: 'Count words',
        fields: [],
        validate: () => null,
        params: () => ({}),
        render: data => h('div', { class: 'stat-row' }, [window.UI.stat('Words', String(data.words))]),
      }, api);
    },
  });
})();
```

The `api` object passed to `render` provides `invoke(action, params)`, `pickFiles({ filters, multiple })`, `pickFolder(title)`, `saveFile({ defaultName, filters })`, `reveal(path)` and `toast(message, kind)`. File and folder paths sent to actions must come from these pickers — Tool Hub rejects paths the user did not choose.

### 4. Build, sign and install

```bash
npm run addon:build -- path\to\my-addon --key C:\keys\my-addon-key.pem
```

This writes `dist/addons/word-counter-1.0.0.thaddon`. Add it with **Tool Library → Add add-on…**. The install dialog will show it as signed by "My add-ons".

### Working in the background

A tool normally loads when its screen opens. Set `"background": true` on a tool (Tool Hub 5.1.0 or later) to keep it working while the screen is closed. Its module can then export:

| Export | Runs |
|---|---|
| `onStart(ctx)` | when Tool Hub starts, and when the tool is switched on |
| `onStop(ctx)` | when the tool is switched off |
| `onRemove(ctx)` | just before the add-on is removed; delete anything the tool stored. Works on any tool in Tool Hub 5.2.0 or later, even without `background` |

Keep background work light, and make sure the user can turn it off. Clipboard Manager is a working example.

## Add-on reference

**Manifest fields**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | 2–64 lowercase letters, digits or dashes. Unique per add-on. |
| `name`, `version` | yes | `version` is `major.minor.patch`. |
| `description` | no | Shown in the Tool Library. |
| `minAppVersion`, `maxAppVersion` | no | Tool Hub versions the add-on supports. |
| `tools[]` | yes | 1–50 tools: `id`, `name`, optional `module` (path inside the add-on), `category`, `icon` (up to 3 characters), `description`, `platforms` (e.g. `"win32,darwin,linux"`), `background` (see below). Tool ids must not clash with built-in tools. |
| `scripts[]`, `styles[]` | no | Renderer files, loaded in order when Tool Hub starts. |

**Runtime**

- Renderer files are served from `toolhub-addon://<id>/<path>`; fetches of other files in your add-on (fonts, data) use the same URLs.
- Main-process modules are loaded with `require`, so `require('electron')` and Node built-ins are available. Bundle any other dependencies inside the add-on.
- Actions run only when the add-on is installed and compatible; errors you throw are shown to the user as messages.

**Package format** (`src/core/addon-format.js`): an 8-byte magic `THADDON\x01`, a JSON header (manifest, signer key id and a table of files with their SHA-256), an Ed25519 signature of the header, then each file deflate-compressed. Paths are checked so a package can never write outside its own folder.
