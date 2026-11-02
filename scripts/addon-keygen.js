#!/usr/bin/env node
// Create an Ed25519 key pair for signing Tool Hub add-ons.
//
//   npm run addon:keygen                      -> ~/.toolhub/addon-signing-key.pem
//   npm run addon:keygen -- --out my-key.pem  -> custom location
//
// The private key never belongs in a repository. Share only the public key it prints.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { keyId } = require('../src/core/addon-format');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = path.resolve(outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : path.join(os.homedir(), '.toolhub', 'addon-signing-key.pem'));

if (fs.existsSync(out)) {
  console.error(`A key already exists at ${out}. Refusing to overwrite it — add-ons signed with it would stop verifying.`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const publicBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(out.replace(/\.pem$/i, '') + '.pub.txt', `${publicBase64}\n`);

console.log(`Private key written to: ${out}`);
console.log('Keep it secret and back it up. Anyone with this file can sign add-ons as you.\n');
console.log(`Public key (share this, paste it into Tool Library > Trusted keys):\n${publicBase64}\n`);
console.log(`Key fingerprint: ${keyId(publicBase64)}`);
