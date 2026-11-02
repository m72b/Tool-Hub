// Optimize PDF: compress, repair, OCR, PDF/A.
(function () {
  const { h, clear, fmtBytes, statusNote } = window.UI;
  const K = window.PdfKit;
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFArray, PDFDict, PDFHexString, PDFString } = window.PDFLib;

  const LEVELS = {
    low: { label: 'Light — best quality', maxDim: 2600, quality: 0.85 },
    recommended: { label: 'Recommended — good quality, smaller', maxDim: 1800, quality: 0.72 },
    extreme: { label: 'Strong — smallest file', maxDim: 1100, quality: 0.5 },
  };

  const nameOf = value => (value instanceof PDFName ? value.asString().slice(1) : null);
  const num = (dict, key) => { const v = dict.lookup(PDFName.of(key)); return v instanceof PDFNumber ? v.asNumber() : null; };

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // Decode an image XObject into a canvas, or return null when its encoding is not one we can safely rewrite.
  async function decodeImage(stream) {
    const dict = stream.dict;
    const filter = dict.lookup(PDFName.of('Filter'));
    const filterName = filter instanceof PDFArray ? (filter.size() === 1 ? nameOf(filter.lookup(0)) : null) : nameOf(filter);
    const width = num(dict, 'Width'), height = num(dict, 'Height');
    const space = nameOf(dict.lookup(PDFName.of('ColorSpace')));
    if (!width || !height || dict.has(PDFName.of('Decode')) || dict.lookup(PDFName.of('ImageMask'))) return null;
    if (filterName === 'DCTDecode') {
      if (space !== 'DeviceRGB' && space !== 'DeviceGray') return null;
      const bitmap = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
      return { bitmap, width, height };
    }
    if (filterName === 'FlateDecode' && num(dict, 'BitsPerComponent') === 8 && !dict.has(PDFName.of('DecodeParms')) && (space === 'DeviceRGB' || space === 'DeviceGray')) {
      const raw = await inflate(stream.contents);
      const channels = space === 'DeviceRGB' ? 3 : 1;
      if (raw.length < width * height * channels) return null;
      const image = new ImageData(width, height);
      for (let i = 0, p = 0; i < width * height; i++, p += channels) {
        image.data[i * 4] = raw[p];
        image.data[i * 4 + 1] = raw[channels === 3 ? p + 1 : p];
        image.data[i * 4 + 2] = raw[channels === 3 ? p + 2 : p];
        image.data[i * 4 + 3] = 255;
      }
      return { bitmap: await createImageBitmap(image), width, height };
    }
    return null;
  }

  async function compressImages(doc, level, report) {
    const settings = LEVELS[level];
    const images = doc.context.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFRawStream && nameOf(obj.dict.lookup(PDFName.of('Subtype'))) === 'Image');
    let changed = 0;
    for (const [i, [ref, stream]] of images.entries()) {
      if (i % 5 === 0) report(`Optimizing images ${i + 1} of ${images.length}…`);
      let decoded;
      try { decoded = await decodeImage(stream); } catch { decoded = null; }
      if (!decoded) continue;
      const scale = Math.min(1, settings.maxDim / Math.max(decoded.width, decoded.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await K.canvasBytes(canvas, 'image/jpeg', settings.quality);
      if (jpeg.length >= stream.contents.length * 0.92) continue;
      const dict = stream.dict.clone(doc.context);
      dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      dict.set(PDFName.of('Width'), PDFNumber.of(canvas.width));
      dict.set(PDFName.of('Height'), PDFNumber.of(canvas.height));
      dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
      dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      dict.set(PDFName.of('Length'), PDFNumber.of(jpeg.length));
      dict.delete(PDFName.of('DecodeParms'));
      doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
      changed++;
    }
    return { total: images.length, changed };
  }

  K.register({
    id: 'compress', name: 'Compress PDF', icon: 'CMP', groups: ['optimize'],
    description: 'Shrink PDFs by re-encoding large images and packing objects, while keeping them readable.',
    render(api) {
      const files = K.fileList(api, { label: 'Add PDFs' });
      let level = 'recommended';
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Compress', onclick: () => K.busy(run, status, 'Compressing…', async report => {
        if (!files.state.files.length) throw new Error('Add at least one PDF');
        const outputDir = await api.pickFolder('Folder for the compressed PDFs');
        if (!outputDir) return null;
        const rows = [];
        const out = [];
        for (const file of files.state.files) {
          report(`Reading ${file.name}…`);
          const original = await K.readBytes(api, file.path);
          const doc = await K.loadPdfLib(original);
          const stats = await compressImages(doc, level, report);
          const bytes = await doc.save({ useObjectStreams: true });
          const smaller = bytes.length < original.length;
          out.push({ name: `${K.stem(file.name)}-compressed.pdf`, bytes: smaller ? bytes : original });
          rows.push({ name: file.name, before: original.length, after: smaller ? bytes.length : original.length, images: stats });
        }
        const result = await K.call(api, 'writeFiles', { outputDir, files: out });
        const wrap = h('div', { class: 'results' }, [K.doneNote(api, `Saved ${result.files.length} file(s).`, result.files[0])]);
        wrap.appendChild(window.UI.table([{ label: 'File', width: 'minmax(0,1fr)' }, { label: 'Before', width: '90px' }, { label: 'After', width: '90px' }, { label: 'Saved', width: '80px' }],
          rows.map(row => h('div', { class: 'tbl-row' }, [h('span', { class: 'ellipsis', text: row.name }), h('span', { class: 'mono', text: fmtBytes(row.before) }), h('span', { class: 'mono', text: fmtBytes(row.after) }), h('span', { class: 'mono', text: row.after < row.before ? `${Math.round(100 - row.after * 100 / row.before)}%` : '—' })]))));
        if (rows.some(row => row.after >= row.before)) wrap.appendChild(statusNote('Some files could not be made smaller (they are mostly text or already optimized); they were copied unchanged.', 'info'));
        return wrap;
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, h('div', { class: 'pdf-options' }, [K.field('Compression', K.select(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level, value => { level = value; }))]), h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  K.register({
    id: 'repair', name: 'Repair PDF', icon: 'FIX', groups: ['optimize'],
    description: 'Rebuild a damaged PDF and recover as much of it as possible.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Repair PDF', onclick: () => K.busy(run, status, 'Repairing…', async () => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const output = await K.saveAs(api, `${K.stem(chosen.name)}-repaired.pdf`);
        if (!output) return null;
        const found = await K.engines(api);
        if (found.qpdf) {
          const result = await K.call(api, 'qpdf', { operation: 'repair', path: chosen.path, output });
          return K.doneNote(api, result.warnings.length ? `Repaired. qpdf fixed ${result.warnings.length} problem(s).` : 'The file was rebuilt; no damage was found.', output);
        }
        const doc = await PDFDocument.load(await K.readBytes(api, chosen.path), { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
        const fresh = await PDFDocument.create();
        for (const page of await fresh.copyPages(doc, doc.getPageIndices())) fresh.addPage(page);
        await K.writeOutput(api, output, await fresh.save());
        return K.doneNote(api, `Recovered ${fresh.getPageCount()} page(s).`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- OCR ----------

  async function ocrFont(api, doc) {
    const latin = await doc.embedFont(K.FONTS.Helvetica);
    let unicode = null;
    return async text => {
      if (!/[^\u0000-ÿ]/.test(text)) return latin;
      if (unicode === null) {
        unicode = false;
        try {
          const font = await K.call(api, 'systemFont', {});
          if (font.bytes) { doc.registerFontkit(window.fontkit); unicode = await doc.embedFont(new Uint8Array(font.bytes), { subset: true }); }
        } catch { unicode = false; }
      }
      return unicode || null;
    };
  }

  K.register({
    id: 'ocr', name: 'OCR PDF', icon: 'OCR', groups: ['optimize', 'intelligence'],
    description: 'Make scanned PDFs searchable and selectable by adding a hidden text layer.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const status = h('div');
      const options = h('div', { class: 'pdf-options' });
      const skip = K.checkbox('Skip pages that already contain text', true);
      let language = '';
      K.engines(api).then(found => {
        clear(options);
        if (!found.ocrEngine) { options.appendChild(statusNote(api.platform === 'win32' ? 'Windows OCR is not available on this PC.' : 'Install Tesseract OCR to use this tool.', 'warn')); return; }
        language = found.ocr[0]?.tag || '';
        options.appendChild(K.field('Document language', K.select(found.ocr.map(lang => [lang.tag, lang.name]), language, value => { language = value; }), api.platform === 'win32' ? 'More languages can be added in Windows Settings > Time & language > Language.' : ''));
        options.appendChild(skip);
      }).catch(err => options.appendChild(statusNote(err.message, 'error')));
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Make searchable', onclick: () => K.busy(run, status, 'Reading text…', async report => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const output = await K.saveAs(api, `${K.stem(chosen.name)}-searchable.pdf`);
        if (!output) return null;
        const bytes = await K.readBytes(api, chosen.path);
        const pdfjs = await K.openPdfJs(bytes);
        const doc = await K.loadPdfLib(bytes);
        const fontFor = await ocrFont(api, doc);
        let added = 0, skipped = 0, missingGlyphs = 0;
        for (let p = 1; p <= pdfjs.numPages; p++) {
          const page = await pdfjs.getPage(p);
          if (skip.input.checked && (await page.getTextContent()).items.some(item => item.str.trim())) { skipped++; continue; }
          report(`Reading page ${p} of ${pdfjs.numPages}…`);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(3, 2600 / Math.max(base.width, base.height));
          const canvas = await K.renderPage(page, scale);
          const result = await K.call(api, 'ocr', { images: [await K.canvasBytes(canvas, 'image/png')], language });
          const target = doc.getPage(p - 1);
          for (const word of result.pages[0]?.words || []) {
            const text = String(word.t || '').trim();
            if (!text) continue;
            const font = await fontFor(text);
            if (!font) { missingGlyphs++; continue; }
            const rect = K.toPdfRect(page, { x: word.x / scale, y: word.y / scale, w: word.w / scale, h: word.h / scale });
            let size = Math.max(2, rect.height * 0.85);
            const width = font.widthOfTextAtSize(text, size);
            if (width > 0) size = Math.max(rect.height * 0.4, Math.min(rect.height * 1.3, size * (rect.width / width)));
            target.drawText(text, { x: rect.x, y: rect.y + rect.height * 0.15, size, font, opacity: 0, rotate: rect.rotate });
            added++;
          }
        }
        await K.writeOutput(api, output, await doc.save());
        const parts = [`Added ${added} words of searchable text.`];
        if (skipped) parts.push(`${skipped} page(s) already had text and were skipped.`);
        if (missingGlyphs) parts.push(`${missingGlyphs} word(s) could not be added because no suitable font was found.`);
        return K.doneNote(api, parts.join(' '), output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, options, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- PDF/A ----------

  const xmlEscape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function addPdfAMetadata(doc, title, iccBytes) {
    const now = new Date();
    const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    doc.setProducer('Tool Hub');
    doc.setModificationDate(now);
    if (!doc.getCreationDate()) doc.setCreationDate(now);
    if (title) doc.setTitle(title);
    const created = (doc.getCreationDate() || now).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
<pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
<dc:format>application/pdf</dc:format>
${title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlEscape(title)}</rdf:li></rdf:Alt></dc:title>` : ''}
<xmp:CreateDate>${created}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate>
<pdf:Producer>Tool Hub</pdf:Producer>
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
    const context = doc.context;
    const metadata = context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), context.register(metadata));
    const profile = context.register(context.flateStream(iccBytes, { N: 3 }));
    const intent = context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: profile });
    doc.catalog.set(PDFName.of('OutputIntents'), context.obj([intent]));
    // PDF/A forbids JavaScript and automatic actions.
    doc.catalog.delete(PDFName.of('OpenAction'));
    doc.catalog.delete(PDFName.of('AA'));
    const names = doc.catalog.lookup(PDFName.of('Names'));
    if (names instanceof PDFDict) names.delete(PDFName.of('JavaScript'));
    const id = PDFHexString.of([...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''));
    context.trailerInfo.ID = context.obj([id, id]);
  }

  function unembeddedFonts(doc) {
    const missing = new Set();
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || nameOf(obj.lookup(PDFName.of('Type'))) !== 'FontDescriptor') continue;
      if (!['FontFile', 'FontFile2', 'FontFile3'].some(key => obj.has(PDFName.of(key)))) missing.add(nameOf(obj.lookup(PDFName.of('FontName'))) || 'unnamed font');
    }
    return [...missing];
  }

  K.register({
    id: 'pdfa', name: 'PDF to PDF/A', icon: 'P/A', groups: ['optimize', 'convert'],
    description: 'Convert to PDF/A-2b for long-term archiving, with colour profile and archival metadata.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const flatten = K.checkbox('Turn pages into images (guarantees fonts and transparency comply; text is no longer selectable)', false);
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Convert to PDF/A', onclick: () => K.busy(run, status, 'Converting…', async report => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const output = await K.saveAs(api, `${K.stem(chosen.name)}-pdfa.pdf`);
        if (!output) return null;
        const bytes = await K.readBytes(api, chosen.path);
        let doc;
        if (flatten.input.checked) {
          const pdfjs = await K.openPdfJs(bytes);
          doc = await PDFDocument.create();
          for (let p = 1; p <= pdfjs.numPages; p++) {
            report(`Rendering page ${p} of ${pdfjs.numPages}…`);
            const page = await pdfjs.getPage(p);
            const base = page.getViewport({ scale: 1 });
            const image = await doc.embedJpg(await K.canvasBytes(await K.renderPage(page, 200 / 72), 'image/jpeg', 0.9));
            doc.addPage([base.width, base.height]).drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
          }
        } else doc = await K.loadPdfLib(bytes);
        const icc = await K.call(api, 'iccProfile', {});
        addPdfAMetadata(doc, doc.getTitle() || K.stem(chosen.name), new Uint8Array(icc.bytes));
        const missing = flatten.input.checked ? [] : unembeddedFonts(doc);
        await K.writeOutput(api, output, await doc.save({ useObjectStreams: false }));
        const wrap = h('div', { class: 'results' }, [K.doneNote(api, 'Saved as PDF/A-2b.', output)]);
        if (missing.length) wrap.appendChild(statusNote(`These fonts are not embedded, so the file will not pass strict PDF/A validation: ${missing.slice(0, 8).join(', ')}. Tick "Turn pages into images" to fix that.`, 'warn'));
        else wrap.appendChild(statusNote('Tool Hub adds the archival structure PDF/A requires, but does not run a full validator. Check with a PDF/A validator (for example veraPDF) if you need certified compliance.', 'info'));
        return wrap;
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, h('div', { class: 'pdf-options' }, [flatten]), h('div', { class: 'action-row' }, [run]), status]);
    },
  });
})();
