const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const safe = require('../core/safe');

async function run(params, ctx = {}) {
  const root = safe.existingDir(params.root);
  const sizeMiB = safe.toInt(params.sizeMiB, 128, 32, 1024);
  const totalBytes = sizeMiB * 1024 * 1024, chunkSize = 1024 * 1024;
  const target = path.join(root, `.toolhub-benchmark-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`);
  let handle;
  const started = process.hrtime.bigint();
  try {
    handle = await fs.promises.open(target, 'wx');
    let written = 0;
    while (written < totalBytes) {
      if (ctx.signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
      const bytes = Math.min(chunkSize, totalBytes - written), buffer = Buffer.allocUnsafe(bytes);
      crypto.randomFillSync(buffer);
      await handle.write(buffer, 0, bytes, written); written += bytes;
      ctx.progress?.({ phase: 'write', completed: written, total: totalBytes });
    }
    await handle.sync();
    const writeSeconds = Number(process.hrtime.bigint() - started) / 1e9;
    const readStarted = process.hrtime.bigint();
    const buffer = Buffer.allocUnsafe(chunkSize); let read = 0;
    while (read < totalBytes) {
      if (ctx.signal?.aborted) { const err = new Error('Operation cancelled'); err.name = 'AbortError'; throw err; }
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, totalBytes - read), read);
      if (!bytesRead) break;
      read += bytesRead;
      ctx.progress?.({ phase: 'read', completed: read, total: totalBytes });
    }
    const readSeconds = Number(process.hrtime.bigint() - readStarted) / 1e9;
    return { root, sizeMiB, writeMiBs: +(sizeMiB / Math.max(writeSeconds, .001)).toFixed(1), readMiBs: +(sizeMiB / Math.max(readSeconds, .001)).toFixed(1), writeSeconds: +writeSeconds.toFixed(2), readSeconds: +readSeconds.toFixed(2) };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.unlink(target).catch(() => {});
  }
}

module.exports = { id: 'disk-benchmark', actions: { run } };
