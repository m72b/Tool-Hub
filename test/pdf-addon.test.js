// Exercises the PDF Tools add-on's main-process module straight from the source tree.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const safe = require(path.join(__dirname, '..', 'src', 'core', 'safe'));
const ADDON = path.join(__dirname, '..', 'addons', 'pdf-tools');
const pdf = require(path.join(ADDON, 'main', 'index.js'));
const ooxml = require(path.join(ADDON, 'main', 'ooxml.js'));
const { PDFDocument } = require(path.join(ADDON, 'vendor', 'pdf-lib.min.js'));

const ctx = { platform: process.platform, lib: { safe } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfaddon-'));

// Minimal ZIP reader to check our writer's output.
function unzipEntries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const nameLen = buffer.readUInt16LE(pos + 28), extra = buffer.readUInt16LE(pos + 30), comment = buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42), size = buffer.readUInt32LE(pos + 20), crc = buffer.readUInt32LE(pos + 16);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLen);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buffer.subarray(dataStart, dataStart + size));
    assert.strictEqual(ooxml.crc32(data), crc, `crc of ${name}`);
    out[name] = data.toString('utf8');
    pos += 46 + nameLen + extra + comment;
  }
  return out;
}

(async () => {
  // OOXML writers produce well-formed packages
  const docx = unzipEntries(ooxml.docx([{ type: 'heading', level: 1, text: 'Title & <more>' }, { type: 'paragraph', text: 'Body' }, { type: 'bullet', text: 'Item' }, { type: 'pageBreak' }]));
  assert.ok(docx['word/document.xml'].includes('Title &amp; &lt;more&gt;'), 'docx escapes text');
  assert.ok(docx['[Content_Types].xml'] && docx['word/styles.xml'].includes('Heading1'));
  const xlsx = unzipEntries(ooxml.xlsx([{ name: 'Page 1', rows: [['Name', 'Amount'], ['A', '1,234.50']] }]));
  assert.ok(xlsx['xl/worksheets/sheet1.xml'].includes('<v>1234.5</v>'), 'numbers stored as numbers');
  const pptx = unzipEntries(ooxml.pptx([{ image: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }], 720, 540));
  assert.ok(pptx['ppt/slides/slide1.xml'] && pptx['ppt/presentation.xml'].includes('cx="9144000"'));

  // ICC profile is a plausible ICC v2 display profile
  const icc = (await pdf.actions.iccProfile()).bytes;
  assert.strictEqual(icc.readUInt32BE(0), icc.length, 'icc size header');
  assert.strictEqual(icc.toString('latin1', 36, 40), 'acsp');
  assert.strictEqual(icc.toString('latin1', 16, 20), 'RGB ');

  // File I/O
  const sample = await PDFDocument.create();
  sample.addPage([300, 300]).drawText('Hello Tool Hub', { x: 40, y: 150, size: 18 });
  sample.addPage([300, 300]);
  const samplePath = path.join(tmp, 'sample.pdf');
  fs.writeFileSync(samplePath, await sample.save());
  const read = await pdf.actions.readFile({ path: samplePath }, ctx);
  assert.strictEqual(read.name, 'sample.pdf');
  const written = await pdf.actions.writeFiles({ outputDir: tmp, files: [{ name: 'a.pdf', bytes: read.bytes }, { name: 'a.pdf', bytes: read.bytes }] }, ctx);
  assert.deepStrictEqual(written.files.map(f => path.basename(f)), ['a.pdf', 'a (2).pdf'], 'writeFiles never overwrites');
  await assert.rejects(() => pdf.actions.writeFiles({ outputDir: tmp, files: [{ name: '..', bytes: read.bytes }] }, ctx), /Invalid output name/);

  // qpdf: protect -> unlock -> repair (needs a qpdf build; the add-on build step bundles one for Windows)
  const found = await pdf.actions.engines({ refresh: true }, ctx);
  const cached = path.join(__dirname, '..', 'node_modules', '.cache', 'toolhub-addons', 'qpdf-11.9.1', 'qpdf-11.9.1-msvc64', 'bin');
  if (!found.qpdf && process.platform === 'win32' && fs.existsSync(cached)) {
    fs.cpSync(cached, path.join(ADDON, 'vendor', 'qpdf', 'bin'), { recursive: true });
  }
  const qpdfReady = (await pdf.actions.engines({ refresh: true }, ctx)).qpdf;
  if (qpdfReady) {
    const locked = path.join(tmp, 'locked.pdf');
    await pdf.actions.qpdf({ operation: 'encrypt', path: samplePath, output: locked, userPassword: 's3cret' }, ctx);
    await assert.rejects(() => PDFDocument.load(fs.readFileSync(locked)), /encrypted/i, 'output is encrypted');
    await assert.rejects(() => pdf.actions.qpdf({ operation: 'decrypt', path: locked, output: path.join(tmp, 'bad.pdf'), password: 'wrong' }, ctx), /password is incorrect/);
    const unlocked = path.join(tmp, 'unlocked.pdf');
    await pdf.actions.qpdf({ operation: 'decrypt', path: locked, output: unlocked, password: 's3cret' }, ctx);
    assert.strictEqual((await PDFDocument.load(fs.readFileSync(unlocked))).getPageCount(), 2, 'unlocked copy opens');
    const broken = path.join(tmp, 'broken.pdf');
    const original = fs.readFileSync(samplePath);
    fs.writeFileSync(broken, original.subarray(0, original.lastIndexOf(Buffer.from('xref'))));
    const repaired = path.join(tmp, 'repaired.pdf');
    await pdf.actions.qpdf({ operation: 'repair', path: broken, output: repaired }, ctx);
    assert.strictEqual((await PDFDocument.load(fs.readFileSync(repaired))).getPageCount(), 2, 'repaired file has both pages');
    await assert.rejects(() => pdf.actions.qpdf({ operation: 'encrypt', path: samplePath, output: samplePath, userPassword: 'x' }, ctx), /different output/);
    console.log('pdf add-on: qpdf protect/unlock/repair checked');
  } else console.log('pdf add-on: qpdf not available here, skipped protect/unlock/repair');

  const docxOut = path.join(tmp, 'out.docx');
  await pdf.actions.writeDocx({ output: docxOut, blocks: [{ type: 'paragraph', text: 'x' }] }, ctx);
  assert.ok(fs.statSync(docxOut).size > 500);
  fs.writeFileSync(path.join(tmp, 'check.xlsx'), ooxml.xlsx([{ name: 'S', rows: [['a', '2']] }]));
  fs.writeFileSync(path.join(tmp, 'check.pptx'), ooxml.pptx([{ image: fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.png')) }], 720, 405));
  if (process.env.TOOLHUB_OOXML_DIR) for (const f of ['out.docx', 'check.xlsx', 'check.pptx']) fs.copyFileSync(path.join(tmp, f), path.join(process.env.TOOLHUB_OOXML_DIR, f));

  fs.rmSync(path.join(ADDON, 'vendor', 'qpdf'), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('pdf add-on: all checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
