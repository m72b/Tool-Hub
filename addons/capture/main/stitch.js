// Joins frames of a scrolling page into one tall image. Frames are { width, height, data } with 4 bytes per pixel.
const MIN_MATCHED_ROWS = 8;
const MIN_MATCH_RATIO = 0.97;

function hashRows(frame) {
  const { width, height, data } = frame;
  const stride = width * 4;
  const rows = new Int32Array(height);
  const plain = new Uint8Array(height);
  const step = Math.max(1, Math.floor(width / 256));
  for (let y = 0; y < height; y++) {
    const start = y * stride;
    let hash = 2166136261;
    let same = 1;
    for (let x = 0; x < width; x += step) {
      const at = start + x * 4;
      const pixel = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16);
      hash = Math.imul(hash ^ pixel, 16777619);
      if (same && pixel !== (data[start] | (data[start + 1] << 8) | (data[start + 2] << 16))) same = 0;
    }
    rows[y] = hash;
    plain[y] = same;
  }
  return { rows, plain };
}

// How far `next` moved past `previous`. Rows that stayed put (sticky headers and footers) are left out.
function findScroll(previous, next) {
  const height = previous.rows.length;
  let top = 0;
  while (top < height && previous.rows[top] === next.rows[top]) top++;
  if (top === height) return { moved: 0, top, bottom: 0 };
  let bottom = 0;
  while (bottom < height - top && previous.rows[height - 1 - bottom] === next.rows[height - 1 - bottom]) bottom++;
  const body = height - top - bottom;
  let best = null;
  for (let moved = 1; moved <= body - MIN_MATCHED_ROWS; moved++) {
    const overlap = body - moved;
    let matched = 0;
    let useful = 0;
    for (let i = 0; i < overlap; i++) {
      if (previous.rows[top + moved + i] !== next.rows[top + i]) continue;
      matched++;
      if (!next.plain[top + i]) useful++;
    }
    if (matched / overlap < MIN_MATCH_RATIO || useful < MIN_MATCHED_ROWS) continue;
    if (!best || useful > best.useful) best = { moved, useful };
  }
  return best ? { moved: best.moved, top, bottom } : { moved: -1, top, bottom };
}

// Returns the joined frame and how many frames could not be joined, because they moved too far or scrolled up.
function stitch(frames, { maxHeight = 30000 } = {}) {
  const first = frames[0];
  const { width, height } = first;
  const stride = width * 4;
  const hashes = frames.map(hashRows);
  const steps = [];
  let total = height;
  let reference = 0;
  let skipped = 0;
  let fixedBottom = 0;
  for (let i = 1; i < frames.length; i++) {
    const found = findScroll(hashes[reference], hashes[i]);
    if (found.moved === 0) continue;
    if (found.moved < 0) { skipped++; continue; }
    if (total + found.moved > maxHeight) break;
    steps.push({ frame: i, moved: found.moved, bottom: found.bottom });
    fixedBottom = Math.max(fixedBottom, found.bottom);
    total += found.moved;
    reference = i;
  }
  const output = Buffer.alloc(total * stride);
  // Rows held back at the bottom of each frame are a sticky footer: it is written once, at the very end.
  const bodyEnd = height - fixedBottom;
  frames[0].data.copy(output, 0, 0, bodyEnd * stride);
  let y = bodyEnd;
  for (const step of steps) {
    const start = bodyEnd - step.moved;
    frames[step.frame].data.copy(output, y * stride, start * stride, bodyEnd * stride);
    y += step.moved;
  }
  const last = frames[steps.length ? steps[steps.length - 1].frame : 0];
  last.data.copy(output, y * stride, bodyEnd * stride, height * stride);
  return { width, height: y + fixedBottom, data: output.subarray(0, (y + fixedBottom) * stride), joined: steps.length + 1, skipped };
}

module.exports = { stitch, hashRows, findScroll };
