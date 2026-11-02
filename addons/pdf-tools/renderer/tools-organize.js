// Organize PDF: merge, split, reorder/delete/insert pages, rotate.
(function () {
  const { h, clear, statusNote } = window.UI;
  const K = window.PdfKit;
  const { PDFDocument, degrees } = window.PDFLib;

  K.register({
    id: 'merge', name: 'Merge PDF', icon: 'MRG', groups: ['organize'],
    description: 'Combine several PDFs into one file, in the order you choose.',
    render(api) {
      const files = K.fileList(api, { label: 'Add PDFs' });
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Merge PDFs', onclick: () => K.busy(run, status, 'Merging…', async report => {
        if (files.state.files.length < 2) throw new Error('Add at least two PDFs');
        const output = await K.saveAs(api, 'merged.pdf');
        if (!output) return null;
        const merged = await PDFDocument.create();
        for (const [i, file] of files.state.files.entries()) {
          report(`Adding ${file.name} (${i + 1} of ${files.state.files.length})…`);
          const doc = await K.loadPdfLib(await K.readBytes(api, file.path));
          for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
        }
        await K.writeOutput(api, output, await merged.save());
        return K.doneNote(api, `Merged ${merged.getPageCount()} pages into ${window.UI.baseName(output)}.`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  K.register({
    id: 'split', name: 'Split PDF', icon: 'SPL', groups: ['organize'],
    description: 'Separate pages or ranges into independent PDF files.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      let mode = 'ranges';
      const ranges = K.textInput('1-3, 4-6', 'e.g. 1-3, 5, 8-10');
      const every = K.numberInput(1, { min: '1' });
      const options = h('div', { class: 'pdf-options' });
      const drawOptions = () => {
        clear(options);
        options.appendChild(K.field('Split mode', K.select([['ranges', 'Each range becomes a file'], ['fixed', 'Every N pages'], ['all', 'Every page as its own file'], ['extract', 'Extract pages into one file']], mode, value => { mode = value; drawOptions(); })));
        if (mode === 'ranges' || mode === 'extract') options.appendChild(K.field('Pages', ranges, 'Page numbers and ranges, separated by commas'));
        if (mode === 'fixed') options.appendChild(K.field('Pages per file', every));
      };
      drawOptions();
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Split PDF', onclick: () => K.busy(run, status, 'Splitting…', async () => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        const source = await K.loadPdfLib(await K.readBytes(api, chosen.path));
        const total = source.getPageCount();
        let groups;
        if (mode === 'ranges') groups = K.parseRanges(ranges.value, total).map(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
        else if (mode === 'fixed') { const n = Math.max(1, Number(every.value) || 1); groups = []; for (let i = 0; i < total; i += n) groups.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k)); }
        else if (mode === 'all') groups = Array.from({ length: total }, (_, i) => [i]);
        else groups = [K.pageList(ranges.value, total)];
        const build = async pages => { const doc = await PDFDocument.create(); for (const page of await doc.copyPages(source, pages)) doc.addPage(page); return doc.save(); };
        const base = K.stem(chosen.name);
        if (mode === 'extract') {
          const output = await K.saveAs(api, `${base}-extract.pdf`);
          if (!output) return null;
          await K.writeOutput(api, output, await build(groups[0]));
          return K.doneNote(api, `Saved ${groups[0].length} page(s).`, output);
        }
        const outputDir = await api.pickFolder('Folder for the split files');
        if (!outputDir) return null;
        const outFiles = [];
        for (const pages of groups) outFiles.push({ name: `${base} p${pages[0] + 1}${pages.length > 1 ? `-${pages[pages.length - 1] + 1}` : ''}.pdf`, bytes: await build(pages) });
        const result = await K.call(api, 'writeFiles', { outputDir, files: outFiles });
        return K.doneNote(api, `Created ${result.files.length} PDF file(s).`, result.files[0]);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, options, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  K.register({
    id: 'organize', name: 'Organize PDF', icon: 'ORG', groups: ['organize'],
    description: 'Reorder, rotate, delete or insert pages, and combine pages from several PDFs.',
    render(api) {
      const sources = [];
      let pages = [];
      let dragIndex = null;
      const grid = h('div', { class: 'pdf-thumb-grid' });
      const status = h('div');

      const thumb = async (src, index) => {
        const page = await src.pdfjs.getPage(index + 1);
        const scale = 150 / page.getViewport({ scale: 1 }).width;
        return K.renderPage(page, scale * 1.5);
      };

      const draw = () => {
        clear(grid);
        if (!pages.length) { grid.appendChild(h('div', { class: 'pdf-drop-hint', text: 'Add a PDF to see its pages.' })); return; }
        pages.forEach((entry, i) => {
          const holder = h('div', { class: 'pdf-thumb-img' });
          if (entry.canvas) { entry.canvas.style.transform = `rotate(${entry.rotation}deg)`; holder.appendChild(entry.canvas); }
          else holder.appendChild(h('div', { class: 'pdf-blank', text: 'Blank page' }));
          const card = h('div', { class: 'pdf-thumb', draggable: 'true' }, [
            holder,
            h('div', { class: 'pdf-thumb-bar' }, [
              h('span', { class: 'muted', text: String(i + 1) }),
              h('button', { class: 'mini-btn', type: 'button', text: '⟳', title: 'Rotate 90°', onclick: () => { entry.rotation = (entry.rotation + 90) % 360; draw(); } }),
              h('button', { class: 'mini-btn', type: 'button', text: '+', title: 'Insert a blank page after', onclick: () => { pages.splice(i + 1, 0, { blank: true, size: entry.size, rotation: 0 }); draw(); } }),
              h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', title: 'Delete page', onclick: () => { pages.splice(i, 1); draw(); } }),
            ]),
          ]);
          card.addEventListener('dragstart', () => { dragIndex = i; card.classList.add('dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
          card.addEventListener('dragover', event => event.preventDefault());
          card.addEventListener('drop', event => { event.preventDefault(); if (dragIndex === null || dragIndex === i) return; pages.splice(i, 0, pages.splice(dragIndex, 1)[0]); dragIndex = null; draw(); });
          grid.appendChild(card);
        });
      };

      const add = h('button', { class: 'btn btn-sm', type: 'button', text: 'Add PDF…', onclick: () => K.busy(add, status, 'Loading pages…', async () => {
        for (const file of await K.pickPdfs(api, true)) {
          const bytes = await K.readBytes(api, file.path);
          const src = { name: file.name, bytes, pdfjs: await K.openPdfJs(bytes) };
          sources.push(src);
          for (let i = 0; i < src.pdfjs.numPages; i++) {
            const view = (await src.pdfjs.getPage(i + 1)).getViewport({ scale: 1 });
            pages.push({ source: sources.length - 1, index: i, rotation: 0, size: [view.width, view.height], canvas: await thumb(src, i) });
          }
        }
        draw();
        return null;
      }) });
      const save = h('button', { class: 'btn btn-accent', type: 'button', text: 'Save PDF', onclick: () => K.busy(save, status, 'Saving…', async () => {
        if (!pages.length) throw new Error('There are no pages to save');
        const output = await K.saveAs(api, `${K.stem(sources[0]?.name)}-organized.pdf`);
        if (!output) return null;
        const doc = await PDFDocument.create();
        const loaded = [];
        for (const entry of pages) {
          if (entry.blank) { doc.addPage(entry.size || [595.28, 841.89]); continue; }
          loaded[entry.source] = loaded[entry.source] || await K.loadPdfLib(sources[entry.source].bytes);
          const [page] = await doc.copyPages(loaded[entry.source], [entry.index]);
          page.setRotation(degrees((page.getRotation().angle + entry.rotation) % 360));
          doc.addPage(page);
        }
        await K.writeOutput(api, output, await doc.save());
        return K.doneNote(api, `Saved ${pages.length} page(s).`, output);
      }) });
      draw();
      return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'action-row' }, [add, save, h('span', { class: 'field-hint', text: 'Drag pages to reorder them.' })]), status, grid]);
    },
  });

  K.register({
    id: 'rotate', name: 'Rotate PDF', icon: 'ROT', groups: ['organize'],
    description: 'Rotate all or some pages, in one or many PDFs at once.',
    render(api) {
      const files = K.fileList(api, { label: 'Add PDFs' });
      let angle = '90';
      const which = K.textInput('', 'All pages (or e.g. 1, 3-5)');
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Rotate', onclick: () => K.busy(run, status, 'Rotating…', async () => {
        if (!files.state.files.length) throw new Error('Add at least one PDF');
        const outputDir = await api.pickFolder('Folder for the rotated PDFs');
        if (!outputDir) return null;
        const out = [];
        for (const file of files.state.files) {
          const doc = await K.loadPdfLib(await K.readBytes(api, file.path));
          for (const index of K.pageList(which.value, doc.getPageCount())) {
            const page = doc.getPage(index);
            page.setRotation(degrees((page.getRotation().angle + Number(angle)) % 360));
          }
          out.push({ name: `${K.stem(file.name)}-rotated.pdf`, bytes: await doc.save() });
        }
        const result = await K.call(api, 'writeFiles', { outputDir, files: out });
        return K.doneNote(api, `Rotated ${result.files.length} PDF(s).`, result.files[0]);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, h('div', { class: 'pdf-options' }, [
        K.field('Rotation', K.select([['90', '90° clockwise'], ['180', '180°'], ['270', '90° counter-clockwise']], angle, value => { angle = value; })),
        K.field('Pages', which),
      ]), h('div', { class: 'action-row' }, [run]), status]);
    },
  });
})();
