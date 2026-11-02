// Convert PDF: to/from Office, images, HTML and Markdown.
(function () {
  const { h, clear, statusNote } = window.UI;
  const K = window.PdfKit;
  const { PDFDocument, PageSizes } = window.PDFLib;

  const OFFICE_LINKS = [['Get LibreOffice (free)', 'https://www.libreoffice.org/download/download-libreoffice/'], ['Microsoft 365', 'https://www.microsoft.com/microsoft-365']];

  // ---------- text extraction shared by Word, Excel and Markdown conversions ----------

  // Returns lines per page: [{ text, size, x, y, cells: [{ text, x, end }] }] in reading order.
  async function extractPages(pdfjs, report) {
    const pages = [];
    for (let p = 1; p <= pdfjs.numPages; p++) {
      if (report) report(`Reading page ${p} of ${pdfjs.numPages}…`);
      const page = await pdfjs.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter(item => item.str && item.str.trim()).map(item => {
        const size = Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
        return { text: item.str, x: item.transform[4], y: item.transform[5], size, width: item.width };
      }).sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const item of items) {
        const line = lines.find(l => Math.abs(l.y - item.y) < Math.max(2, l.size * 0.45));
        if (line) line.items.push(item);
        else lines.push({ y: item.y, size: item.size, items: [item] });
      }
      for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x);
        line.size = Math.max(...line.items.map(item => item.size));
        line.x = line.items[0].x;
        const cells = [];
        let text = '';
        let prevEnd = null;
        for (const item of line.items) {
          const gap = prevEnd === null ? 0 : item.x - prevEnd;
          if (prevEnd === null || gap > line.size * 1.8) cells.push({ text: item.text, x: item.x, end: item.x + item.width });
          else { const cell = cells[cells.length - 1]; cell.text += (gap > line.size * 0.15 && !/\s$/.test(cell.text) ? ' ' : '') + item.text; cell.end = item.x + item.width; }
          text += (prevEnd !== null && gap > line.size * 0.15 && !/\s$/.test(text) ? ' ' : '') + item.text;
          prevEnd = item.x + item.width;
        }
        line.text = text.replace(/\s+/g, ' ').trim();
        line.cells = cells.map(cell => ({ ...cell, text: cell.text.replace(/\s+/g, ' ').trim() }));
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push({ lines, page });
    }
    return pages;
  }

  function bodySize(pages) {
    const counts = new Map();
    for (const page of pages) for (const line of page.lines) { const key = Math.round(line.size); counts.set(key, (counts.get(key) || 0) + line.text.length); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  }

  const BULLET = /^([•·▪●◦‣\-–*]|\(?\d{1,3}[.)]|[a-z][.)])\s+/i;

  // Groups lines into headings, bullets and paragraphs.
  function toBlocks(pages) {
    const body = bodySize(pages);
    const headingSizes = [...new Set(pages.flatMap(p => p.lines.map(l => Math.round(l.size))).filter(size => size > body * 1.15))].sort((a, b) => b - a);
    const blocks = [];
    pages.forEach((page, index) => {
      if (index > 0) blocks.push({ type: 'pageBreak' });
      let paragraph = null;
      let prev = null;
      const flush = () => { if (paragraph) blocks.push(paragraph); paragraph = null; };
      for (const line of page.lines) {
        const rounded = Math.round(line.size);
        if (rounded > body * 1.15 && line.text.length < 160) {
          flush();
          blocks.push({ type: 'heading', level: Math.min(3, headingSizes.indexOf(rounded) + 1 || 3), text: line.text });
        } else if (BULLET.test(line.text)) {
          flush();
          blocks.push({ type: 'bullet', text: line.text.replace(BULLET, ''), marker: line.text.match(BULLET)[1] });
        } else if (paragraph && prev && prev.y - line.y < line.size * 1.9 && Math.abs(prev.size - line.size) < 1) {
          paragraph.text += (paragraph.text.endsWith('-') ? '' : ' ') + line.text;
          if (paragraph.text.endsWith('-')) paragraph.text = paragraph.text.slice(0, -1);
        } else {
          flush();
          paragraph = { type: 'paragraph', text: line.text };
        }
        prev = line;
      }
      flush();
    });
    return blocks;
  }

  // Lays each page's text out as a grid of rows and columns.
  function toSheets(pages) {
    return pages.map((page, index) => {
      const starts = [];
      for (const line of page.lines) for (const cell of line.cells) {
        const near = starts.find(s => Math.abs(s.x - cell.x) < 12);
        if (near) near.count++; else starts.push({ x: cell.x, count: 1 });
      }
      starts.sort((a, b) => a.x - b.x);
      const columnOf = x => { let best = 0; starts.forEach((s, i) => { if (Math.abs(s.x - x) < Math.abs(starts[best].x - x)) best = i; }); return best; };
      const rows = page.lines.map(line => {
        const row = [];
        for (const cell of line.cells) {
          let col = columnOf(cell.x);
          while (row[col] !== undefined) col++;
          row[col] = cell.text;
        }
        return Array.from(row, value => value ?? '');
      });
      return { name: `Page ${index + 1}`, rows };
    });
  }

  K.extractPages = extractPages;
  K.toBlocks = toBlocks;

  // ---------- PDF to Office ----------

  function pdfToOfficeTool({ id, name, icon, format, description, label }) {
    K.register({
      id, name, icon, groups: ['convert'], description,
      render(api) {
        const file = K.fileList(api, { multiple: false });
        const preferEngine = K.checkbox(format === 'xlsx' ? '' : 'Use Microsoft Office or LibreOffice when installed (keeps layout closer to the original)', true);
        const options = h('div', { class: 'pdf-options' });
        if (format !== 'xlsx') options.appendChild(preferEngine);
        K.engines(api).then(found => {
          const available = format === 'docx' ? (found.word || found.libreoffice) : format === 'pptx' ? found.libreoffice : false;
          if (format === 'xlsx') options.appendChild(statusNote('Tables are rebuilt from the text positions on each page; each page becomes a worksheet. Scanned PDFs need OCR PDF first.', 'info'));
          else if (!available) options.appendChild(K.engineNote(format === 'pptx'
            ? 'Without LibreOffice, each page becomes a picture on its own slide.'
            : 'Without Microsoft Word or LibreOffice, Tool Hub rebuilds the text, headings and lists (not the exact layout).', OFFICE_LINKS));
        }).catch(() => {});
        const status = h('div');
        const run = h('button', { class: 'btn btn-accent', type: 'button', text: `Convert to ${label}`, onclick: () => K.busy(run, status, 'Converting…', async report => {
          const chosen = file.state.files[0];
          if (!chosen) throw new Error('Choose a PDF first');
          const output = await K.saveAs(api, `${K.stem(chosen.name)}.${format}`, [{ name: label, extensions: [format] }]);
          if (!output) return null;
          if (format !== 'xlsx' && preferEngine.input.checked) {
            report('Converting with your office suite…');
            const result = await K.call(api, 'pdfToOffice', { path: chosen.path, output, format });
            if (!result.unavailable) return K.doneNote(api, `Converted with ${result.engine}.`, output);
          }
          const bytes = await K.readBytes(api, chosen.path);
          const pdfjs = await K.openPdfJs(bytes);
          if (format === 'pptx') {
            const slides = [];
            let size = null;
            for (let p = 1; p <= pdfjs.numPages; p++) {
              report(`Rendering page ${p} of ${pdfjs.numPages}…`);
              const page = await pdfjs.getPage(p);
              if (!size) { const v = page.getViewport({ scale: 1 }); size = [v.width, v.height]; }
              slides.push({ image: await K.canvasBytes(await K.renderPage(page, 2), 'image/jpeg', 0.9) });
            }
            await K.call(api, 'writePptx', { output, slides, width: size[0], height: size[1] });
            return K.doneNote(api, `Created ${slides.length} slide(s).`, output);
          }
          const pages = await extractPages(pdfjs, report);
          if (!pages.some(p => p.lines.length)) throw new Error('No text was found. If this is a scanned PDF, run OCR PDF first.');
          if (format === 'xlsx') await K.call(api, 'writeXlsx', { output, sheets: toSheets(pages) });
          else await K.call(api, 'writeDocx', { output, blocks: toBlocks(pages).map(({ marker, ...block }) => block) });
          return K.doneNote(api, `Converted ${pdfjs.numPages} page(s).`, output);
        }) });
        return h('div', { class: 'pdf-tool-body' }, [file.el, options, h('div', { class: 'action-row' }, [run]), status]);
      },
    });
  }

  pdfToOfficeTool({ id: 'pdf-word', name: 'PDF to Word', icon: 'DOC', format: 'docx', label: 'Word', description: 'Turn a PDF into an editable Word document (.docx).' });
  pdfToOfficeTool({ id: 'pdf-ppt', name: 'PDF to PowerPoint', icon: 'PPT', format: 'pptx', label: 'PowerPoint', description: 'Turn PDF pages into a PowerPoint presentation (.pptx).' });
  pdfToOfficeTool({ id: 'pdf-excel', name: 'PDF to Excel', icon: 'XLS', format: 'xlsx', label: 'Excel', description: 'Pull tables and text from a PDF into an Excel workbook (.xlsx).' });

  // ---------- Office to PDF ----------

  function officeToPdfTool({ id, name, icon, kind, extensions, label, description }) {
    K.register({
      id, name, icon, groups: ['convert'], description,
      render(api) {
        const files = K.fileList(api, { label: `Add ${label} files`, filters: [{ name: `${label} files`, extensions }] });
        const notice = h('div');
        K.engines(api).then(found => {
          if (!found[kind] && !found.libreoffice) notice.appendChild(K.engineNote(`Converting ${label} files needs Microsoft ${label} or LibreOffice installed on this PC.`, OFFICE_LINKS));
          else notice.appendChild(statusNote(`Converts with ${found[kind] ? `Microsoft ${label}` : 'LibreOffice'}.`, 'info'));
        }).catch(() => {});
        const status = h('div');
        const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Convert to PDF', onclick: () => K.busy(run, status, 'Converting…', async report => {
          if (!files.state.files.length) throw new Error(`Add at least one ${label} file`);
          const outputDir = await api.pickFolder('Folder for the PDFs');
          if (!outputDir) return null;
          const sep = outputDir.includes('\\') ? '\\' : '/';
          let done = 0;
          let last = null;
          for (const file of files.state.files) {
            report(`Converting ${file.name}…`);
            const output = `${outputDir}${outputDir.endsWith(sep) ? '' : sep}${K.stem(file.name)}.pdf`;
            const result = await K.call(api, 'officeToPdf', { path: file.path, output });
            if (result.unavailable) throw new Error(`Install Microsoft ${label} or LibreOffice to convert ${label} files.`);
            done++;
            last = output;
          }
          return K.doneNote(api, `Converted ${done} file(s).`, last);
        }) });
        return h('div', { class: 'pdf-tool-body' }, [files.el, notice, h('div', { class: 'action-row' }, [run]), status]);
      },
    });
  }

  officeToPdfTool({ id: 'word-pdf', name: 'Word to PDF', icon: 'W→P', kind: 'word', label: 'Word', extensions: ['doc', 'docx', 'rtf', 'odt', 'txt'], description: 'Convert DOC and DOCX documents to PDF.' });
  officeToPdfTool({ id: 'ppt-pdf', name: 'PowerPoint to PDF', icon: 'P→P', kind: 'powerpoint', label: 'PowerPoint', extensions: ['ppt', 'pptx', 'odp'], description: 'Convert PPT and PPTX slideshows to PDF.' });
  officeToPdfTool({ id: 'excel-pdf', name: 'Excel to PDF', icon: 'X→P', kind: 'excel', label: 'Excel', extensions: ['xls', 'xlsx', 'ods', 'csv'], description: 'Convert Excel spreadsheets to PDF.' });

  // ---------- PDF to JPG ----------

  async function extractImages(doc) {
    const { PDFName, PDFRawStream, PDFNumber, PDFArray } = window.PDFLib;
    const nameOf = v => (v instanceof PDFName ? v.asString().slice(1) : null);
    const out = [];
    let skipped = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || nameOf(obj.dict.lookup(PDFName.of('Subtype'))) !== 'Image') continue;
      const filter = obj.dict.lookup(PDFName.of('Filter'));
      const filterName = filter instanceof PDFArray ? nameOf(filter.lookup(filter.size() - 1)) : nameOf(filter);
      if (filterName === 'DCTDecode') { out.push(obj.contents); continue; }
      const width = obj.dict.lookup(PDFName.of('Width')), height = obj.dict.lookup(PDFName.of('Height'));
      const space = nameOf(obj.dict.lookup(PDFName.of('ColorSpace')));
      const bpc = obj.dict.lookup(PDFName.of('BitsPerComponent'));
      if (filterName === 'FlateDecode' && width instanceof PDFNumber && height instanceof PDFNumber && bpc instanceof PDFNumber && bpc.asNumber() === 8 && (space === 'DeviceRGB' || space === 'DeviceGray') && !obj.dict.has(PDFName.of('DecodeParms'))) {
        const w = width.asNumber(), hgt = height.asNumber(), channels = space === 'DeviceRGB' ? 3 : 1;
        const raw = new Uint8Array(await new Response(new Blob([obj.contents]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
        if (raw.length < w * hgt * channels) { skipped++; continue; }
        const image = new ImageData(w, hgt);
        for (let i = 0, p = 0; i < w * hgt; i++, p += channels) { image.data.set([raw[p], raw[channels === 3 ? p + 1 : p], raw[channels === 3 ? p + 2 : p], 255], i * 4); }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = hgt;
        canvas.getContext('2d').putImageData(image, 0, 0);
        out.push(await K.canvasBytes(canvas, 'image/jpeg', 0.92));
      } else skipped++;
    }
    return { images: out, skipped };
  }

  K.register({
    id: 'pdf-jpg', name: 'PDF to JPG', icon: 'JPG', groups: ['convert'],
    description: 'Save every page as a JPG image, or pull out the pictures inside a PDF.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      let mode = 'pages', dpi = '150';
      const pages = K.textInput('', 'All pages (or e.g. 1-3, 7)');
      const options = h('div', { class: 'pdf-options' });
      const draw = () => {
        clear(options);
        options.appendChild(K.field('Mode', K.select([['pages', 'Convert pages to JPG'], ['images', 'Extract images']], mode, value => { mode = value; draw(); })));
        if (mode === 'pages') { options.appendChild(K.field('Quality', K.select([['72', 'Screen (72 dpi)'], ['150', 'Normal (150 dpi)'], ['300', 'High (300 dpi)']], dpi, value => { dpi = value; }))); options.appendChild(K.field('Pages', pages)); }
      };
      draw();
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Convert', onclick: () => K.busy(run, status, 'Converting…', async report => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const outputDir = await api.pickFolder('Folder for the images');
        if (!outputDir) return null;
        const bytes = await K.readBytes(api, chosen.path);
        const base = K.stem(chosen.name);
        const out = [];
        let note = '';
        if (mode === 'pages') {
          const pdfjs = await K.openPdfJs(bytes);
          for (const index of K.pageList(pages.value, pdfjs.numPages)) {
            report(`Rendering page ${index + 1}…`);
            out.push({ name: `${base}-page-${String(index + 1).padStart(3, '0')}.jpg`, bytes: await K.canvasBytes(await K.renderPage(await pdfjs.getPage(index + 1), Number(dpi) / 72), 'image/jpeg', 0.9) });
          }
        } else {
          const { images, skipped } = await extractImages(await K.loadPdfLib(bytes));
          images.forEach((image, i) => out.push({ name: `${base}-image-${String(i + 1).padStart(3, '0')}.jpg`, bytes: image }));
          if (skipped) note = ` ${skipped} image(s) use an encoding Tool Hub cannot export and were skipped.`;
          if (!out.length) throw new Error(`No exportable images were found in this PDF.${note}`);
        }
        const result = await K.call(api, 'writeFiles', { outputDir, files: out });
        return K.doneNote(api, `Saved ${result.files.length} image(s).${note}`, result.files[0]);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, options, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- JPG to PDF ----------

  K.register({
    id: 'jpg-pdf', name: 'JPG to PDF', icon: 'IMG', groups: ['convert'],
    description: 'Turn images into a PDF, with page size, orientation and margins.',
    render(api) {
      const files = K.fileList(api, { label: 'Add images', filters: K.IMAGE_FILTER });
      let size = 'fit', orientation = 'auto', margin = '0';
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Create PDF', onclick: () => K.busy(run, status, 'Creating PDF…', async report => {
        if (!files.state.files.length) throw new Error('Add at least one image');
        const output = await K.saveAs(api, 'images.pdf');
        if (!output) return null;
        const doc = await PDFDocument.create();
        for (const [i, file] of files.state.files.entries()) {
          report(`Adding image ${i + 1} of ${files.state.files.length}…`);
          const image = await K.embedImage(doc, await K.imageToEmbeddable(await K.readBytes(api, file.path), file.name));
          const pad = Number(margin);
          let [pw, ph] = size === 'fit' ? [image.width + pad * 2, image.height + pad * 2] : PageSizes[size];
          const landscape = orientation === 'landscape' || (orientation === 'auto' && image.width > image.height);
          if (size !== 'fit' && landscape !== pw > ph) [pw, ph] = [ph, pw];
          const scale = Math.min((pw - pad * 2) / image.width, (ph - pad * 2) / image.height, size === 'fit' ? 1 : Infinity);
          const w = image.width * scale, hgt = image.height * scale;
          doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
        }
        await K.writeOutput(api, output, await doc.save());
        return K.doneNote(api, `Created a ${doc.getPageCount()}-page PDF.`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, h('div', { class: 'pdf-options' }, [
        K.field('Page size', K.select([['fit', 'Same as image'], ['A4', 'A4'], ['Letter', 'US Letter']], size, value => { size = value; })),
        K.field('Orientation', K.select([['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], orientation, value => { orientation = value; })),
        K.field('Margin', K.select([['0', 'No margin'], ['20', 'Small'], ['50', 'Large']], margin, value => { margin = value; })),
      ]), h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- HTML to PDF ----------

  K.register({
    id: 'html-pdf', name: 'HTML to PDF', icon: 'WEB', groups: ['convert'],
    description: 'Save a web page or a local HTML file as a PDF.',
    render(api) {
      const url = K.textInput('', 'https://example.com');
      let localFile = null;
      const localLabel = h('span', { class: 'path-display empty', text: 'or choose an HTML file' });
      const pickLocal = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose HTML file…', onclick: async () => {
        const chosen = await api.pickFiles({ filters: [{ name: 'Web pages', extensions: ['html', 'htm'] }], multiple: false });
        if (!chosen?.length) return;
        localFile = chosen[0];
        localLabel.textContent = localFile.path;
        localLabel.classList.remove('empty');
        url.value = '';
      } });
      let pageSize = 'A4', margin = 'small';
      const landscape = K.checkbox('Landscape', false);
      const background = K.checkbox('Include background colours and images', true);
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Convert to PDF', onclick: () => K.busy(run, status, 'Loading the page…', async () => {
        if (!url.value.trim() && !localFile) throw new Error('Enter a web address or choose an HTML file');
        const output = await K.saveAs(api, `${localFile ? K.stem(localFile.name) : 'webpage'}.pdf`);
        if (!output) return null;
        const params = { output, pageSize, margin, landscape: landscape.input.checked, background: background.input.checked };
        if (url.value.trim()) params.url = url.value.trim(); else params.path = localFile.path;
        const result = await K.call(api, 'htmlToPdf', params);
        return K.doneNote(api, `Saved "${result.title || 'page'}" as PDF.`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [
        K.field('Web address', url), h('div', { class: 'action-row' }, [pickLocal, localLabel]),
        h('div', { class: 'pdf-options' }, [
          K.field('Page size', K.select(['A4', 'Letter', 'Legal', 'A3', 'A5'].map(s => [s, s]), pageSize, value => { pageSize = value; })),
          K.field('Margins', K.select([['none', 'None'], ['small', 'Small'], ['normal', 'Normal']], margin, value => { margin = value; })),
          landscape, background,
        ]),
        statusNote('Web pages are loaded in a private, sandboxed window. Pages behind a login cannot be converted.', 'info'),
        h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- PDF to Markdown ----------

  function linkify(page, lines, annotations) {
    for (const link of annotations.filter(a => a.subtype === 'Link' && a.url)) {
      const [x1, y1, x2, y2] = link.rect;
      for (const line of lines) {
        if (line.y < Math.min(y1, y2) - 2 || line.y > Math.max(y1, y2) + 2) continue;
        const inside = line.items.filter(item => item.x >= Math.min(x1, x2) - 2 && item.x <= Math.max(x1, x2) + 2).map(item => item.text).join('').trim();
        if (inside && line.text.includes(inside) && !line.text.includes(`](${link.url})`)) { line.text = line.text.replace(inside, `[${inside}](${link.url})`); break; }
      }
    }
  }

  function markdownTable(rows) {
    const width = Math.max(...rows.map(r => r.length));
    const cell = value => String(value || '').replace(/\|/g, '\\|');
    const lines = rows.map(r => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(' | ')} |`);
    lines.splice(1, 0, `|${' --- |'.repeat(width)}`);
    return lines.join('\n');
  }

  K.register({
    id: 'pdf-markdown', name: 'PDF to Markdown', icon: 'MD', groups: ['convert', 'intelligence'],
    description: 'Turn a PDF into Markdown, keeping headings, lists, simple tables and links.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const preview = h('textarea', { class: 'input mono pdf-md-preview', rows: '14', readonly: true, placeholder: 'The Markdown appears here after converting.' });
      const status = h('div');
      let markdown = '';
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Convert', onclick: () => K.busy(run, status, 'Converting…', async report => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const pdfjs = await K.openPdfJs(await K.readBytes(api, chosen.path));
        const pages = await extractPages(pdfjs, report);
        for (const page of pages) linkify(page.page, page.lines, await page.page.getAnnotations());
        const body = bodySize(pages);
        const headingSizes = [...new Set(pages.flatMap(p => p.lines.map(l => Math.round(l.size))).filter(s => s > body * 1.15))].sort((a, b) => b - a);
        const out = [];
        for (const page of pages) {
          let table = [];
          let paragraph = [];
          let prev = null;
          const flushParagraph = () => { if (paragraph.length) out.push(paragraph.join(' ').replace(/-\s(?=[a-z])/g, '')); paragraph = []; };
          const flushTable = () => { if (table.length >= 2) out.push(markdownTable(table.map(line => line.cells.map(c => c.text)))); else table.forEach(line => paragraph.push(line.text)); table = []; };
          for (const line of page.lines) {
            const rounded = Math.round(line.size);
            if (line.cells.length >= 2 && (!table.length || Math.abs(table[0].cells.length - line.cells.length) <= 1)) { flushParagraph(); table.push(line); prev = line; continue; }
            flushTable();
            if (rounded > body * 1.15 && line.text.length < 160) { flushParagraph(); out.push(`${'#'.repeat(Math.min(4, headingSizes.indexOf(rounded) + 1 || 4))} ${line.text}`); }
            else if (BULLET.test(line.text)) { flushParagraph(); const marker = line.text.match(BULLET)[1]; out.push(`${/\d/.test(marker) ? `${marker.replace(/[()]/g, '').replace(/\)$/, '.')}` : '-'} ${line.text.replace(BULLET, '')}`); }
            else if (prev && prev.y - line.y > line.size * 1.9) { flushParagraph(); paragraph.push(line.text); }
            else paragraph.push(line.text);
            prev = line;
          }
          flushTable();
          flushParagraph();
        }
        markdown = out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
        if (!markdown.trim()) throw new Error('No text was found. If this is a scanned PDF, run OCR PDF first.');
        preview.value = markdown;
        save.disabled = false;
        return `Converted ${pdfjs.numPages} page(s). Review the Markdown below, then save it.`;
      }) });
      const save = h('button', { class: 'btn', type: 'button', text: 'Save .md file', disabled: true, onclick: async () => {
        const output = await K.saveAs(api, `${K.stem(file.state.files[0]?.name)}.md`, [{ name: 'Markdown', extensions: ['md'] }]);
        if (!output) return;
        await K.writeOutput(api, output, new TextEncoder().encode(markdown));
        clear(status);
        status.appendChild(K.doneNote(api, 'Markdown saved.', output));
      } });
      const copy = h('button', { class: 'btn', type: 'button', text: 'Copy', onclick: async () => { if (markdown) { await navigator.clipboard.writeText(markdown); api.toast('Markdown copied', 'ok'); } } });
      return h('div', { class: 'pdf-tool-body' }, [file.el, h('div', { class: 'action-row' }, [run, save, copy]), status, preview]);
    },
  });
})();
