const fs = require('fs');
const crypto = require('crypto');
const { safe } = globalThis.toolHubLib;

async function shred(params) {
  const paths = Array.isArray(params.paths) ? params.paths.slice(0, 1000) : [];
  if (!paths.length) safe.fail('Choose files to shred');
  const results = [];
  for (const raw of paths) {
    try {
      const file = safe.existingFile(raw), st = await fs.promises.lstat(file);
      if (st.isSymbolicLink() || !st.isFile()) safe.fail('Only regular files can be shredded');
      const handle = await fs.promises.open(file, 'r+');
      try {
        const size = 1024 * 1024, buffer = Buffer.alloc(size);
        for (let pass = 0; pass < 2; pass++) {
          let offset = 0;
          while (offset < st.size) {
            const length = Math.min(size, st.size - offset);
            if (pass === 0) crypto.randomFillSync(buffer, 0, length); else buffer.fill(0, 0, length);
            await handle.write(buffer, 0, length, offset); offset += length;
          }
          await handle.sync();
        }
      } finally { await handle.close(); }
      await fs.promises.unlink(file);
      results.push({ path: file, ok: true });
    } catch (err) { results.push({ path: String(raw), ok: false, error: err.message }); }
  }
  return { deleted: results.filter(row => row.ok).length, failed: results.filter(row => !row.ok) };
}

module.exports = { id: 'secure-delete', actions: { shred } };
