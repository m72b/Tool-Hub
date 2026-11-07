// Reads details from TrueType and OpenType fonts, including collections. Damaged fonts return no faces.
const NAME_IDS = { 0: 'copyright', 1: 'family', 2: 'style', 4: 'fullName', 5: 'version', 6: 'postscript', 8: 'manufacturer', 9: 'designer', 10: 'description', 11: 'vendorUrl', 13: 'license', 14: 'licenseUrl', 16: 'typographicFamily', 17: 'typographicStyle' };
const SFNT_TAGS = new Set(['\0\x01\0\0', 'OTTO', 'true', 'typ1']);

function tables(buffer, start) {
  const out = {};
  const count = buffer.readUInt16BE(start + 4);
  for (let i = 0; i < count; i++) {
    const at = start + 12 + i * 16;
    if (at + 16 > buffer.length) break;
    const offset = buffer.readUInt32BE(at + 8);
    const length = buffer.readUInt32BE(at + 12);
    if (offset + length <= buffer.length) out[buffer.toString('latin1', at, at + 4)] = { offset, length };
  }
  return out;
}

function utf16be(buffer) {
  const swapped = Buffer.from(buffer);
  swapped.swap16();
  return swapped.toString('utf16le');
}

function readNames(buffer, table) {
  const found = {};
  if (!table) return found;
  const { offset } = table;
  const count = buffer.readUInt16BE(offset + 2);
  const strings = offset + buffer.readUInt16BE(offset + 4);
  const score = (platform, language) => (platform === 3 && language === 0x409 ? 3 : platform === 3 ? 2 : platform === 0 ? 2 : 1);
  const best = {};
  for (let i = 0; i < count; i++) {
    const at = offset + 6 + i * 12;
    const platform = buffer.readUInt16BE(at);
    const encoding = buffer.readUInt16BE(at + 2);
    const language = buffer.readUInt16BE(at + 4);
    const key = NAME_IDS[buffer.readUInt16BE(at + 6)];
    const length = buffer.readUInt16BE(at + 8);
    const start = strings + buffer.readUInt16BE(at + 10);
    if (!key || start + length > buffer.length || (platform === 3 && encoding !== 1 && encoding !== 10 && encoding !== 0)) continue;
    const rank = score(platform, language);
    if (best[key] >= rank) continue;
    const raw = buffer.subarray(start, start + (length & (platform === 1 ? ~0 : ~1)));
    const text = platform === 1 ? raw.toString('latin1') : utf16be(raw);
    best[key] = rank;
    found[key] = text.replace(/\0/g, '').trim();
  }
  return found;
}

function readFace(buffer, start) {
  const list = tables(buffer, start);
  if (!list.name && !list.head) return null;
  const names = readNames(buffer, list.name);
  const face = {
    ...names,
    family: names.typographicFamily || names.family || '',
    style: names.typographicStyle || names.style || 'Regular',
    outlines: buffer.toString('latin1', start, start + 4) === 'OTTO' ? 'PostScript (OpenType)' : 'TrueType',
    weight: 400,
    width: 5,
    italic: false,
    monospace: false,
    glyphs: 0,
    unitsPerEm: 0,
    embedding: '',
    vendor: '',
  };
  delete face.typographicFamily;
  delete face.typographicStyle;
  if (list.head && list.head.length >= 54) {
    face.unitsPerEm = buffer.readUInt16BE(list.head.offset + 18);
    face.italic = (buffer.readUInt16BE(list.head.offset + 44) & 2) !== 0;
  }
  if (list.maxp) face.glyphs = buffer.readUInt16BE(list.maxp.offset + 4);
  if (list.post && list.post.length >= 16) {
    face.monospace = buffer.readUInt32BE(list.post.offset + 12) !== 0;
    if (buffer.readInt32BE(list.post.offset + 4) !== 0) face.italic = true;
  }
  if (list['OS/2'] && list['OS/2'].length >= 10) {
    const os2 = list['OS/2'].offset;
    face.weight = buffer.readUInt16BE(os2 + 4);
    face.width = buffer.readUInt16BE(os2 + 6);
    const type = buffer.readUInt16BE(os2 + 8);
    face.embedding = (type & 2) ? 'Restricted' : (type & 4) ? 'Preview and print' : (type & 8) ? 'Editable' : 'Installable';
    if (list['OS/2'].length >= 62) face.vendor = buffer.toString('latin1', os2 + 58, os2 + 62).replace(/\0/g, '').trim();
  }
  return face.family ? face : null;
}

function parseFont(buffer) {
  try {
    if (buffer.length < 12) return [];
    const tag = buffer.toString('latin1', 0, 4);
    if (tag === 'ttcf') {
      const count = Math.min(buffer.readUInt32BE(8), 64);
      const faces = [];
      for (let i = 0; i < count; i++) {
        const face = readFace(buffer, buffer.readUInt32BE(12 + i * 4));
        if (face) faces.push(face);
      }
      return faces;
    }
    if (!SFNT_TAGS.has(tag)) return [];
    const face = readFace(buffer, 0);
    return face ? [face] : [];
  } catch {
    return [];
  }
}

// Finds exact copies (same bytes) and fonts sharing a PostScript name in different files.
function findDuplicates(fonts, hashOf) {
  const bySize = new Map();
  for (const font of fonts) bySize.set(font.size, [...(bySize.get(font.size) || []), font]);
  const exact = [];
  for (const same of bySize.values()) {
    if (same.length < 2) continue;
    const byHash = new Map();
    for (const font of same) { const hash = hashOf(font); byHash.set(hash, [...(byHash.get(hash) || []), font]); }
    for (const group of byHash.values()) if (group.length > 1) exact.push(group);
  }
  const copies = new Set(exact.flat().map(font => font.path));
  const byName = new Map();
  for (const font of fonts) {
    if (font.faces.length !== 1 || !font.faces[0].postscript) continue;
    const key = font.faces[0].postscript.toLowerCase();
    byName.set(key, [...(byName.get(key) || []), font]);
  }
  const named = [...byName.values()].filter(group => group.length > 1 && group.some(font => !copies.has(font.path)));
  return { exact, named };
}

module.exports = { parseFont, findDuplicates };
