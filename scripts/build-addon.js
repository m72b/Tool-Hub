#!/usr/bin/env node
// Build and sign a Tool Hub add-on.
//
//   npm run addon:build -- addons/pdf-tools
//   npm run addon:build -- addons/my-addon --key C:\keys\my-key.pem --out dist/addons
//
// The add-on folder needs an addon.json manifest. An optional build.js exporting
// `async prepare({ addonDir, stageDir, repoRoot })` can add generated or downloaded files.
// The signing key defaults to ~/.toolhub/addon-signing-key.pem or $TOOLHUB_ADDON_KEY.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pack, validateManifest } = require('../src/core/addon-format');

const SKIP = new Set(['addon.json', 'build.js', '.DS_Store', 'Thumbs.db']);

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function collect(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst); else fs.copyFileSync(src, dst);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const repoRoot = path.resolve(__dirname, '..');
  const addonDir = path.resolve(args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--key' && args[args.indexOf(a) - 1] !== '--out') || 'addons/pdf-tools');
  const keyFile = path.resolve(argValue(args, '--key') || process.env.TOOLHUB_ADDON_KEY || path.join(os.homedir(), '.toolhub', 'addon-signing-key.pem'));
  const outDir = path.resolve(argValue(args, '--out') || path.join(repoRoot, 'dist', 'addons'));

  const manifest = validateManifest(JSON.parse(fs.readFileSync(path.join(addonDir, 'addon.json'), 'utf8')));
  if (!fs.existsSync(keyFile)) throw new Error(`No signing key at ${keyFile}. Create one with "npm run addon:keygen" or pass --key.`);

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), `toolhub-addon-${manifest.id}-`));
  try {
    copyTree(addonDir, stageDir);
    fs.mkdirSync(path.join(stageDir, 'licenses'), { recursive: true });
    const buildScript = path.join(addonDir, 'build.js');
    if (fs.existsSync(buildScript)) await require(buildScript)({ addonDir, stageDir, repoRoot });
    const files = collect(stageDir).sort();
    const { buffer, keyId } = pack({ root: stageDir, files, manifest, privateKeyPem: fs.readFileSync(keyFile, 'utf8') });
    fs.mkdirSync(outDir, { recursive: true });
    const output = path.join(outDir, `${manifest.id}-${manifest.version}.thaddon`);
    fs.writeFileSync(output, buffer);
    console.log(`Built ${manifest.name} ${manifest.version}: ${output}`);
    console.log(`${files.length} files, ${(buffer.length / 1048576).toFixed(1)} MB, signed with key ${keyId}`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(`addon:build: ${err.message}`); process.exitCode = 1; });
