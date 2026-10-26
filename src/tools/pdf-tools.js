const fs = require('fs');
const path = require('path');
const safe = require('../core/safe');
const { PDFDocument } = require('../renderer/vendor/pdf-lib.min.js');

function outputPath(dir, name) {
  const outputDir = safe.existingDir(dir);
  if (!safe.safeEntryName(name) || path.extname(name).toLowerCase() !== '.pdf') safe.fail('Output name must be a valid .pdf filename');
  const output = safe.assertInside(outputDir, path.join(outputDir, name));
  if (fs.existsSync(output)) safe.fail('Output file already exists; choose a different name');
  return output;
}

async function merge(params) {
  const paths = Array.isArray(params.paths) ? params.paths.slice(0, 100) : [];
  if (paths.length < 2) safe.fail('Choose at least two PDF files');
  const output = outputPath(params.outputDir, params.name || 'merged.pdf');
  const merged = await PDFDocument.create();
  for (const raw of paths) {
    const file = safe.existingFile(raw);
    const stat = await fs.promises.stat(file);
    if (stat.size > 256 * 1024 * 1024) safe.fail('Each PDF must be under 256 MB');
    const doc = await PDFDocument.load(await fs.promises.readFile(file), { updateMetadata: false });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  await fs.promises.writeFile(output, await merged.save());
  return { output, pages: merged.getPageCount() };
}

async function split(params) {
  const file = safe.existingFile(params.path);
  const output = outputPath(params.outputDir, params.name || 'pages.pdf');
  const source = await PDFDocument.load(await fs.promises.readFile(file), { updateMetadata: false });
  const total = source.getPageCount();
  if (total < 1) safe.fail('This PDF has no pages');
  const start = safe.toInt(params.start, 1, 1, total) - 1;
  const end = safe.toInt(params.end, total, start + 1, total) - 1;
  const result = await PDFDocument.create();
  for (const page of await result.copyPages(source, Array.from({ length: end - start + 1 }, (_, index) => start + index))) result.addPage(page);
  await fs.promises.writeFile(output, await result.save());
  return { output, pages: result.getPageCount(), totalPages: total };
}

module.exports = { id: 'pdf-tools', actions: { merge, split } };
