#!/usr/bin/env node
// Builds and signs every add-on in addons/, writes the signed catalog.json for the GitHub release,
// and copies the Starter add-on to dist/bundled so the installer can include it.
//
//   npm run addons
//
// Upload dist/addons/* to a GitHub release tagged v<app version>, next to the installer.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const format = require('../src/core/addon-format');
const { signCatalog } = require('../src/core/catalog');
const trust = require('../src/core/addon-trust.json');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'addons');
const BUNDLED = path.join(ROOT, 'dist', 'bundled');
const BUNDLED_IDS = ['starter'];
const REPO = 'https://github.com/m72b/Tool-Hub';
const AUTHORIZER = process.env.TOOLHUB_AUTHORIZER || 'm72b';
const keyFile = process.env.TOOLHUB_ADDON_KEY || path.join(os.homedir(), '.toolhub', 'addon-signing-key.pem');

const { version } = require('../package.json');
fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(BUNDLED, { recursive: true, force: true });
fs.mkdirSync(BUNDLED, { recursive: true });

const sections = fs.readdirSync(path.join(ROOT, 'addons'), { withFileTypes: true }).filter(entry => entry.isDirectory() && fs.existsSync(path.join(ROOT, 'addons', entry.name, 'addon.json')));
for (const section of sections) {
  execFileSync(process.execPath, [path.join(__dirname, 'build-addon.js'), path.join('addons', section.name), '--key', keyFile, '--authorizer', AUTHORIZER, '--out', OUT], { cwd: ROOT, stdio: 'inherit' });
}

const entries = [];
for (const name of fs.readdirSync(OUT).filter(file => file.endsWith('.thaddon')).sort()) {
  const buffer = fs.readFileSync(path.join(OUT, name));
  const { manifest } = format.open(buffer, trust);
  entries.push({
    id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description || '',
    minAppVersion: manifest.minAppVersion || null, size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    url: `${REPO}/releases/download/v${version}/${name}`,
    tools: manifest.tools.map(tool => ({ id: tool.id, name: tool.name })),
  });
  if (BUNDLED_IDS.includes(manifest.id)) fs.copyFileSync(path.join(OUT, name), path.join(BUNDLED, `${manifest.id}.thaddon`));
}

fs.writeFileSync(path.join(OUT, 'catalog.json'), signCatalog(entries, fs.readFileSync(keyFile, 'utf8')));
console.log(`\nCatalog: ${entries.map(entry => `${entry.id} ${entry.version}`).join(', ')}`);
console.log(`Upload everything in dist/addons to a GitHub release tagged v${version}.`);
