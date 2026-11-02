// Builds a small ICC v2 sRGB display profile (D50-adapted primaries, sampled sRGB tone curve).
// PDF/A requires an embedded output intent profile; generating it avoids shipping a third-party file.

function s15f16(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(Math.round(value * 65536));
  return buffer;
}

function xyzTag(x, y, z) {
  return Buffer.concat([Buffer.from('XYZ '), Buffer.alloc(4), s15f16(x), s15f16(y), s15f16(z)]);
}

function curveTag() {
  const count = 1024;
  const body = Buffer.alloc(12 + count * 2);
  body.write('curv', 0, 'latin1');
  body.writeUInt32BE(count, 8);
  for (let i = 0; i < count; i++) {
    const v = i / (count - 1);
    const linear = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    body.writeUInt16BE(Math.round(linear * 65535), 12 + i * 2);
  }
  return body;
}

function descTag(text) {
  const ascii = Buffer.from(`${text}\0`, 'latin1');
  const head = Buffer.alloc(12);
  head.write('desc', 0, 'latin1');
  head.writeUInt32BE(ascii.length, 8);
  // Unicode language code + count (0), ScriptCode code + count + 67 reserved bytes.
  return Buffer.concat([head, ascii, Buffer.alloc(8), Buffer.alloc(3 + 67)]);
}

function textTag(text) {
  return Buffer.concat([Buffer.from('text'), Buffer.alloc(4), Buffer.from(`${text}\0`, 'latin1')]);
}

function pad4(buffer) {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra)]) : buffer;
}

function srgbProfile() {
  const curve = curveTag();
  const tags = [
    ['desc', descTag('sRGB (Tool Hub)')],
    ['cprt', textTag('No copyright, use freely')],
    ['wtpt', xyzTag(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyzTag(0.4360, 0.2225, 0.0139)],
    ['gXYZ', xyzTag(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyzTag(0.1431, 0.0606, 0.7141)],
    ['rTRC', curve], ['gTRC', curve], ['bTRC', curve],
  ];
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const table = Buffer.alloc(tableSize);
  table.writeUInt32BE(tags.length, 0);
  const blobs = [];
  const placed = new Map();
  tags.forEach(([signature, data], i) => {
    let at = placed.get(data);
    if (at === undefined) {
      at = offset;
      placed.set(data, at);
      const padded = pad4(data);
      blobs.push(padded);
      offset += padded.length;
    }
    table.write(signature, 4 + i * 12, 'latin1');
    table.writeUInt32BE(at, 8 + i * 12);
    table.writeUInt32BE(data.length, 12 + i * 12);
  });
  const header = Buffer.alloc(128);
  header.writeUInt32BE(offset, 0);
  header.writeUInt32BE(0x02100000, 8);
  header.write('mntr', 12, 'latin1');
  header.write('RGB ', 16, 'latin1');
  header.write('XYZ ', 20, 'latin1');
  const now = new Date();
  [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()].forEach((v, i) => header.writeUInt16BE(v, 24 + i * 2));
  header.write('acsp', 36, 'latin1');
  s15f16(0.9642).copy(header, 68);
  s15f16(1.0).copy(header, 72);
  s15f16(0.8249).copy(header, 76);
  return Buffer.concat([header, table, ...blobs]);
}

module.exports = { srgbProfile };
