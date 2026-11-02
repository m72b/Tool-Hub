// Edit PDF: annotate (text, images, shapes, freehand), watermark, page numbers, crop, forms.
(function () {
  const { h, clear, statusNote } = window.UI;
  const K = window.PdfKit;
  const { PDFDocument, degrees, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = window.PDFLib;

  let nextId = 1;

  // Interactive page annotator shared by Edit PDF and Sign PDF. Items live in view points per page.
  function createAnnotator(api, { tools: enabled = ['select', 'text', 'image', 'rect', 'ellipse', 'line', 'pen'], extraToolbar = [] } = {}) {
    const items = [];
    const props = { mode: 'select', color: '#1a1a1a', size: 14, font: 'Helvetica', stroke: 2, fill: false, fillColor: '#ffe066' };
    let selected = null;
    let viewer = null;
    let pendingImage = null;

    const itemList = h('div', { class: 'pdf-item-list' });
    const drawList = () => {
      clear(itemList);
      if (!items.length) { itemList.appendChild(h('span', { class: 'muted', text: 'Nothing added yet.' })); return; }
      items.forEach(item => itemList.appendChild(h('div', { class: `pdf-item-row${item === selected ? ' active' : ''}` }, [
        h('span', { class: 'ellipsis', text: `p${item.page + 1} · ${item.type === 'text' ? `“${item.text}”` : item.label || item.type}` }),
        h('button', { class: 'mini-btn', type: 'button', text: 'Go to', onclick: () => { selected = item; viewer.show(item.page); drawList(); } }),
        h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', onclick: () => remove(item) }),
      ])));
    };
    const remove = item => { items.splice(items.indexOf(item), 1); if (selected === item) selected = null; viewer.redraw(); drawList(); };

    const svgNS = 'http://www.w3.org/2000/svg';
    const renderItems = (overlay, state) => {
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'pdf-svg-layer');
      overlay.appendChild(svg);
      for (const item of items.filter(it => it.page === state.index)) {
        if (item.type === 'line' || item.type === 'pen') {
          const poly = document.createElementNS(svgNS, 'polyline');
          poly.setAttribute('points', item.points.map(p => `${viewer.px(p.x)},${viewer.px(p.y)}`).join(' '));
          poly.setAttribute('fill', 'none');
          poly.setAttribute('stroke', item.color);
          poly.setAttribute('stroke-width', String(viewer.px(item.stroke)));
          poly.setAttribute('stroke-linecap', 'round');
          poly.setAttribute('stroke-linejoin', 'round');
          poly.addEventListener('pointerdown', event => { event.stopPropagation(); selected = item; drawList(); });
          svg.appendChild(poly);
          continue;
        }
        let el;
        if (item.type === 'text') {
          el = h('div', { class: 'pdf-text-item', text: item.text });
          Object.assign(el.style, { color: item.color, fontSize: `${viewer.px(item.size)}px`, fontFamily: /Times/.test(item.font) ? 'Times New Roman, serif' : /Courier/.test(item.font) ? 'Courier New, monospace' : 'Helvetica, Arial, sans-serif', fontWeight: /Bold/.test(item.font) ? '700' : '400' });
          el.addEventListener('dblclick', event => { event.stopPropagation(); editText(item); });
        } else if (item.type === 'image') {
          el = h('div', { class: 'pdf-image-item' }, [h('img', { src: item.url, alt: '' })]);
        } else {
          el = h('div', { class: `pdf-shape-item${item.type === 'ellipse' ? ' ellipse' : ''}` });
          Object.assign(el.style, { borderColor: item.color, borderWidth: `${viewer.px(item.stroke)}px`, background: item.fill ? item.fillColor : 'transparent' });
        }
        if (item === selected) el.classList.add('selected');
        el.addEventListener('pointerdown', () => { selected = item; drawList(); });
        K.placeBox(viewer, item, el, { resizable: item.type !== 'text', keepRatio: item.type === 'image', onChange: () => drawList() });
      }
    };

    const editText = item => {
      const input = h('textarea', { class: 'pdf-inline-input', rows: '2' });
      input.value = item.text || '';
      Object.assign(input.style, { left: `${viewer.px(item.x)}px`, top: `${viewer.px(item.y)}px`, fontSize: `${Math.max(12, viewer.px(item.size))}px` });
      viewer.overlay.appendChild(input);
      input.focus();
      const commit = () => {
        input.remove();
        const text = input.value.replace(/\s+$/, '');
        if (!text) { if (items.includes(item)) remove(item); return; }
        item.text = text;
        const lines = text.split('\n');
        item.w = Math.max(...lines.map(l => l.length)) * item.size * 0.55 + 4;
        item.h = lines.length * item.size * 1.2;
        if (!items.includes(item)) items.push(item);
        selected = item;
        viewer.redraw();
        drawList();
      };
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); input.blur(); } if (event.key === 'Escape') { input.value = item.text || ''; input.blur(); } });
      input.addEventListener('blur', commit, { once: true });
    };

    viewer = K.pageViewer({
      renderItems,
      onOverlayDown(event, point, state) {
        selected = null;
        const page = state.index;
        if (props.mode === 'text') { editText({ id: nextId++, type: 'text', page, x: point.x, y: point.y, text: '', size: Number(props.size), font: props.font, color: props.color }); return; }
        if (props.mode === 'image') {
          if (!pendingImage) { api.toast('Choose an image first', 'error'); return; }
          const w = Math.min(200, pendingImage.width), hgt = w * pendingImage.height / pendingImage.width;
          items.push({ id: nextId++, type: 'image', page, x: point.x, y: point.y, w, h: hgt, url: pendingImage.url, image: pendingImage.image, label: pendingImage.label || 'image' });
          if (pendingImage.once) { pendingImage = null; setMode('select'); }
          viewer.redraw(); drawList();
          return;
        }
        if (props.mode === 'rect' || props.mode === 'ellipse') {
          K.dragRect(viewer, event, point, rect => { items.push({ id: nextId++, type: props.mode, page, ...rect, color: props.color, stroke: Number(props.stroke), fill: props.fill, fillColor: props.fillColor }); viewer.redraw(); drawList(); });
          return;
        }
        if (props.mode === 'line' || props.mode === 'pen') {
          const item = { id: nextId++, type: props.mode, page, points: [point, point], color: props.color, stroke: Number(props.stroke) };
          items.push(item);
          const move = e => { const p = viewer.toView(e); if (item.type === 'line') item.points[1] = p; else item.points.push(p); viewer.redraw(); };
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (item.points.length < 2 || (item.type === 'line' && Math.hypot(item.points[1].x - item.points[0].x, item.points[1].y - item.points[0].y) < 2)) items.splice(items.indexOf(item), 1); viewer.redraw(); drawList(); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
          return;
        }
        viewer.redraw();
        drawList();
      },
    });

    document.addEventListener('keydown', function onKey(event) {
      if (!viewer.el.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) remove(selected);
    });

    const modeButtons = h('div', { class: 'pdf-modes' });
    const LABELS = { select: 'Select', text: 'Text', image: 'Image', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', pen: 'Draw' };
    const setMode = mode => { props.mode = mode; clear(modeButtons); for (const m of enabled) modeButtons.appendChild(h('button', { class: `settings-mode-btn${props.mode === m ? ' active' : ''}`, type: 'button', text: LABELS[m], onclick: async () => {
      if (m === 'image') {
        const chosen = await api.pickFiles({ filters: K.IMAGE_FILTER, multiple: false });
        if (!chosen?.length) return;
        await useImage(await K.readBytes(api, chosen[0].path), chosen[0].name);
      }
      setMode(m);
    } })); viewer.overlay.classList.toggle('crosshair', mode !== 'select'); };

    const useImage = async (bytes, name, options = {}) => {
      const image = await K.imageToEmbeddable(bytes, name);
      const url = URL.createObjectURL(new Blob([image.bytes], { type: image.kind === 'jpg' ? 'image/jpeg' : 'image/png' }));
      const bitmap = await createImageBitmap(new Blob([image.bytes]));
      pendingImage = { image, url, width: bitmap.width, height: bitmap.height, ...options };
    };

    const colorInput = h('input', { class: 'pdf-color', type: 'color', value: props.color, oninput: e => { props.color = e.target.value; if (selected && 'color' in selected) { selected.color = props.color; viewer.redraw(); } } });
    const fontSelect = K.select(Object.keys(K.FONTS).map(f => [f, f]), props.font, value => { props.font = value; if (selected?.type === 'text') { selected.font = value; viewer.redraw(); } });
    const sizeInput = K.numberInput(props.size, { min: '4', max: '200', oninput: e => { props.size = Number(e.target.value) || 14; if (selected?.type === 'text') { selected.size = props.size; viewer.redraw(); } } });
    const strokeInput = K.numberInput(props.stroke, { min: '0.5', max: '30', step: '0.5', oninput: e => { props.stroke = Number(e.target.value) || 1; } });
    const fillBox = K.checkbox('Fill shapes', false);
    fillBox.input.addEventListener('change', () => { props.fill = fillBox.input.checked; });
    const fillColor = h('input', { class: 'pdf-color', type: 'color', value: props.fillColor, oninput: e => { props.fillColor = e.target.value; } });

    const toolbar = h('div', { class: 'pdf-toolbar' }, [
      modeButtons,
      h('div', { class: 'pdf-props' }, [
        K.field('Colour', colorInput),
        enabled.includes('text') ? K.field('Font', fontSelect) : null,
        enabled.includes('text') ? K.field('Text size', sizeInput) : null,
        enabled.some(m => ['rect', 'ellipse', 'line', 'pen'].includes(m)) ? K.field('Line width', strokeInput) : null,
        enabled.some(m => ['rect', 'ellipse'].includes(m)) ? h('div', { class: 'pdf-fill' }, [fillBox, fillColor]) : null,
        ...extraToolbar,
      ]),
    ]);
    setMode('select');
    drawList();

    // Draws every item into a pdf-lib document, using the pdf.js document for coordinate conversion.
    async function apply(doc, pdfjs) {
      const fonts = {};
      const fontFor = async name => (fonts[name] = fonts[name] || await doc.embedFont(K.FONTS[name] || K.FONTS.Helvetica));
      const pageCache = {};
      const embedded = new Map();
      for (const item of items) {
        const jsPage = pageCache[item.page] = pageCache[item.page] || await pdfjs.getPage(item.page + 1);
        const page = doc.getPage(item.page);
        const color = K.hexColor(item.color);
        if (item.type === 'text') {
          K.checkLatin(item.text);
          const font = await fontFor(item.font);
          item.text.split('\n').forEach((line, i) => {
            const r = K.toPdfRect(jsPage, { x: item.x + 2, y: item.y + i * item.size * 1.2, w: item.w, h: item.size * 0.95 });
            page.drawText(line, { x: r.x, y: r.y, size: item.size, font, color, rotate: r.rotate });
          });
        } else if (item.type === 'image') {
          if (!embedded.has(item.image)) embedded.set(item.image, await K.embedImage(doc, item.image));
          page.drawImage(embedded.get(item.image), K.toPdfRect(jsPage, item));
        } else if (item.type === 'rect') {
          const r = K.toPdfRect(jsPage, item);
          page.drawRectangle({ ...r, borderColor: color, borderWidth: item.stroke, color: item.fill ? K.hexColor(item.fillColor) : undefined });
        } else if (item.type === 'ellipse') {
          const [cx, cy] = K.toPdfPoint(jsPage, item.x + item.w / 2, item.y + item.h / 2);
          const sideways = (jsPage.rotate || 0) % 180 !== 0;
          page.drawEllipse({ x: cx, y: cy, xScale: (sideways ? item.h : item.w) / 2, yScale: (sideways ? item.w : item.h) / 2, borderColor: color, borderWidth: item.stroke, color: item.fill ? K.hexColor(item.fillColor) : undefined });
        } else {
          const pts = item.points.map(p => K.toPdfPoint(jsPage, p.x, p.y));
          if (item.type === 'line') page.drawLine({ start: { x: pts[0][0], y: pts[0][1] }, end: { x: pts[1][0], y: pts[1][1] }, thickness: item.stroke, color, lineCap: 1 });
          else page.drawSvgPath(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`).join(' '), { x: 0, y: 0, borderColor: color, borderWidth: item.stroke, borderLineCap: 1 });
        }
      }
    }

    return { viewer, toolbar, itemList, items, apply, useImage, setMode };
  }
  K.createAnnotator = createAnnotator;

  function annotatorTool({ id, name, icon, groups, description, tools, extra, applyLabel = 'Save PDF', suffix }) {
    K.register({
      id, name, icon, groups, description,
      render(api) {
        let source = null;
        const status = h('div');
        const ann = createAnnotator(api, { tools, extraToolbar: extra ? extra(api, () => ann) : [] });
        const work = h('div', { class: 'pdf-editor', hidden: true }, [ann.toolbar, h('div', { class: 'pdf-editor-main' }, [ann.viewer.el, h('div', { class: 'pdf-editor-side' }, [h('div', { class: 'group-title', text: 'Added' }), ann.itemList])])]);
        const open = h('button', { class: 'btn btn-sm', type: 'button', text: 'Open PDF…', onclick: () => K.busy(open, status, 'Opening…', async () => {
          const [file] = await K.pickPdfs(api, false);
          if (!file) return null;
          const bytes = await K.readBytes(api, file.path);
          source = { file, bytes };
          work.hidden = false;
          await ann.viewer.load(bytes);
          save.disabled = false;
          return null;
        }) });
        const save = h('button', { class: 'btn btn-accent', type: 'button', text: applyLabel, disabled: true, onclick: () => K.busy(save, status, 'Saving…', async () => {
          if (!ann.items.length) throw new Error('Add something to the page first');
          const output = await K.saveAs(api, `${K.stem(source.file.name)}-${suffix}.pdf`);
          if (!output) return null;
          const doc = await K.loadPdfLib(source.bytes);
          await ann.apply(doc, ann.viewer.state.doc);
          await K.writeOutput(api, output, await doc.save());
          return K.doneNote(api, 'Saved your changes to a new PDF.', output);
        }) });
        return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'action-row' }, [open, save, h('span', { class: 'field-hint', text: 'Click the page to add items; drag to move, use the corner to resize, Delete to remove.' })]), status, work]);
      },
    });
  }
  K.annotatorTool = annotatorTool;

  annotatorTool({ id: 'edit', name: 'Edit PDF', icon: 'EDT', groups: ['edit'], suffix: 'edited', description: 'Add text, images, shapes or freehand drawing to a PDF.' });

  // ---------- Watermark ----------

  K.register({
    id: 'watermark', name: 'Watermark', icon: 'WMK', groups: ['edit'],
    description: 'Stamp text or an image over your pages, with transparency, rotation and position.',
    render(api) {
      const files = K.fileList(api, { label: 'Add PDFs' });
      let kind = 'text', position = 'center', font = 'Helvetica Bold', image = null;
      const text = K.textInput('CONFIDENTIAL', 'Watermark text');
      const size = K.numberInput(48, { min: '6', max: '300' });
      const color = h('input', { class: 'pdf-color', type: 'color', value: '#c0392b' });
      const opacity = h('input', { class: 'range', type: 'range', min: '5', max: '100', value: '30' });
      const rotation = K.numberInput(45, { min: '-180', max: '180' });
      const pages = K.textInput('', 'All pages (or e.g. 2-5)');
      const imageLabel = h('span', { class: 'path-display empty', text: 'No image chosen' });
      const options = h('div', { class: 'pdf-options' });
      const draw = () => {
        clear(options);
        options.appendChild(K.field('Type', K.select([['text', 'Text'], ['image', 'Image']], kind, value => { kind = value; draw(); })));
        if (kind === 'text') { options.appendChild(K.field('Text', text)); options.appendChild(K.field('Font', K.select(Object.keys(K.FONTS).map(f => [f, f]), font, value => { font = value; }))); options.appendChild(K.field('Size', size)); options.appendChild(K.field('Colour', color)); }
        else options.appendChild(K.field('Image', h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose image…', onclick: async () => {
          const chosen = await api.pickFiles({ filters: K.IMAGE_FILTER, multiple: false });
          if (!chosen?.length) return;
          image = await K.imageToEmbeddable(await K.readBytes(api, chosen[0].path), chosen[0].name);
          imageLabel.textContent = chosen[0].name; imageLabel.classList.remove('empty');
        } }), imageLabel])));
        options.appendChild(K.field('Position', K.select([['center', 'Centre'], ['top-left', 'Top left'], ['top', 'Top centre'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['tile', 'Repeat across page']], position, value => { position = value; })));
        options.appendChild(K.field('Rotation (°)', rotation));
        options.appendChild(K.field('Transparency', opacity, 'Lower is more see-through'));
        options.appendChild(K.field('Pages', pages));
      };
      draw();
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Add watermark', onclick: () => K.busy(run, status, 'Stamping…', async () => {
        if (!files.state.files.length) throw new Error('Add at least one PDF');
        if (kind === 'text') { if (!text.value.trim()) throw new Error('Enter watermark text'); K.checkLatin(text.value); }
        if (kind === 'image' && !image) throw new Error('Choose a watermark image');
        const outputDir = await api.pickFolder('Folder for the watermarked PDFs');
        if (!outputDir) return null;
        const out = [];
        for (const file of files.state.files) {
          const doc = await K.loadPdfLib(await K.readBytes(api, file.path));
          const embeddedFont = kind === 'text' ? await doc.embedFont(K.FONTS[font]) : null;
          const embeddedImage = kind === 'image' ? await K.embedImage(doc, image) : null;
          const angle = Number(rotation.value) || 0;
          const alpha = Number(opacity.value) / 100;
          for (const index of K.pageList(pages.value, doc.getPageCount())) {
            const page = doc.getPage(index);
            const { width, height } = page.getSize();
            const fontSize = Number(size.value) || 48;
            const w = kind === 'text' ? embeddedFont.widthOfTextAtSize(text.value, fontSize) : Math.min(width * 0.4, embeddedImage.width);
            const hgt = kind === 'text' ? fontSize : w * embeddedImage.height / embeddedImage.width;
            const spots = [];
            if (position === 'tile') { for (let y = hgt; y < height; y += hgt * 3 + 60) for (let x = 20; x < width; x += w + 80) spots.push([x, y]); }
            else {
              const m = 36;
              const col = /left/.test(position) ? m : /right/.test(position) ? width - w - m : (width - w) / 2;
              const row = /^top/.test(position) ? height - hgt - m : /^bottom/.test(position) ? m : (height - hgt) / 2;
              spots.push([col, row]);
            }
            for (const [x, y] of spots) {
              // Rotate around the stamp's centre rather than its corner.
              const rad = angle * Math.PI / 180;
              const cx = x + w / 2, cy = y + hgt / 2;
              const ox = cx - (w / 2) * Math.cos(rad) + (hgt / 2) * Math.sin(rad);
              const oy = cy - (w / 2) * Math.sin(rad) - (hgt / 2) * Math.cos(rad);
              if (kind === 'text') page.drawText(text.value, { x: ox, y: oy, size: fontSize, font: embeddedFont, color: K.hexColor(color.value), opacity: alpha, rotate: degrees(angle) });
              else page.drawImage(embeddedImage, { x: ox, y: oy, width: w, height: hgt, opacity: alpha, rotate: degrees(angle) });
            }
          }
          out.push({ name: `${K.stem(file.name)}-watermarked.pdf`, bytes: await doc.save() });
        }
        const result = await K.call(api, 'writeFiles', { outputDir, files: out });
        return K.doneNote(api, `Watermarked ${result.files.length} PDF(s).`, result.files[0]);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, options, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- Page numbers ----------

  K.register({
    id: 'page-numbers', name: 'Page numbers', icon: '123', groups: ['edit'],
    description: 'Add page numbers with your choice of position, format and typography.',
    render(api) {
      const files = K.fileList(api, { label: 'Add PDFs' });
      let position = 'bottom', font = 'Helvetica';
      const format = K.select([['{n}', '1'], ['Page {n}', 'Page 1'], ['{n} / {total}', '1 / 10'], ['Page {n} of {total}', 'Page 1 of 10'], ['- {n} -', '- 1 -']], '{n}', null);
      const start = K.numberInput(1, { min: '0' });
      const size = K.numberInput(11, { min: '5', max: '72' });
      const margin = K.numberInput(28, { min: '0', max: '200' });
      const color = h('input', { class: 'pdf-color', type: 'color', value: '#333333' });
      const pages = K.textInput('', 'All pages (or e.g. 3-)');
      const skipFirst = K.checkbox('Skip the first page (cover)', false);
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Add page numbers', onclick: () => K.busy(run, status, 'Numbering…', async () => {
        if (!files.state.files.length) throw new Error('Add at least one PDF');
        const outputDir = await api.pickFolder('Folder for the numbered PDFs');
        if (!outputDir) return null;
        const out = [];
        for (const file of files.state.files) {
          const doc = await K.loadPdfLib(await K.readBytes(api, file.path));
          const embedded = await doc.embedFont(K.FONTS[font]);
          let targets = K.pageList(pages.value, doc.getPageCount());
          if (skipFirst.input.checked) targets = targets.filter(i => i !== 0);
          const fontSize = Number(size.value) || 11, m = Number(margin.value) || 0;
          targets.forEach((index, n) => {
            const page = doc.getPage(index);
            const { width, height } = page.getSize();
            const label = format.value.replace('{n}', String((Number(start.value) || 1) + n)).replace('{total}', String(targets.length));
            const w = embedded.widthOfTextAtSize(label, fontSize);
            const x = /left/.test(position) ? m : /right/.test(position) ? width - w - m : (width - w) / 2;
            const y = /^top/.test(position) ? height - m - fontSize : m;
            page.drawText(label, { x, y, size: fontSize, font: embedded, color: K.hexColor(color.value) });
          });
          out.push({ name: `${K.stem(file.name)}-numbered.pdf`, bytes: await doc.save() });
        }
        const result = await K.call(api, 'writeFiles', { outputDir, files: out });
        return K.doneNote(api, `Numbered ${result.files.length} PDF(s).`, result.files[0]);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [files.el, h('div', { class: 'pdf-options' }, [
        K.field('Position', K.select([['bottom', 'Bottom centre'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'], ['top', 'Top centre'], ['top-left', 'Top left'], ['top-right', 'Top right']], position, value => { position = value; })),
        K.field('Format', format), K.field('First number', start), K.field('Font', K.select(Object.keys(K.FONTS).map(f => [f, f]), font, value => { font = value; })),
        K.field('Size', size), K.field('Margin (pt)', margin), K.field('Colour', color), K.field('Pages', pages), skipFirst,
      ]), h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- Crop ----------

  K.register({
    id: 'crop', name: 'Crop PDF', icon: 'CRP', groups: ['edit'],
    description: 'Trim page margins or keep a selected area, on one page or the whole document.',
    render(api) {
      let source = null, crop = null;
      const status = h('div');
      const viewer = K.pageViewer({
        renderItems(overlay) {
          if (!crop || crop.page !== viewer.state.index) return;
          const box = h('div', { class: 'pdf-crop-box' });
          K.placeBox(viewer, crop, box, {});
        },
        onOverlayDown(event, point, state) { K.dragRect(viewer, event, point, rect => { crop = { ...rect, page: state.index }; viewer.redraw(); }); },
      });
      const scope = K.select([['all', 'Apply to all pages'], ['current', 'Only this page']], 'all', null);
      const work = h('div', { class: 'pdf-editor', hidden: true }, [h('div', { class: 'pdf-options' }, [K.field('Apply to', scope), h('span', { class: 'field-hint', text: 'Drag on the page to draw the area to keep. Drag the box to move it, the corner to resize.' })]), viewer.el]);
      const open = h('button', { class: 'btn btn-sm', type: 'button', text: 'Open PDF…', onclick: () => K.busy(open, status, 'Opening…', async () => {
        const [file] = await K.pickPdfs(api, false);
        if (!file) return null;
        source = { file, bytes: await K.readBytes(api, file.path) };
        work.hidden = false;
        crop = null;
        await viewer.load(source.bytes);
        save.disabled = false;
        return null;
      }) });
      const save = h('button', { class: 'btn btn-accent', type: 'button', text: 'Crop and save', disabled: true, onclick: () => K.busy(save, status, 'Cropping…', async () => {
        if (!crop) throw new Error('Drag on the page to choose the area to keep');
        const output = await K.saveAs(api, `${K.stem(source.file.name)}-cropped.pdf`);
        if (!output) return null;
        const doc = await K.loadPdfLib(source.bytes);
        const jsPage = await viewer.state.doc.getPage(crop.page + 1);
        const [x1, y1] = K.toPdfPoint(jsPage, crop.x, crop.y);
        const [x2, y2] = K.toPdfPoint(jsPage, crop.x + crop.w, crop.y + crop.h);
        const box = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)];
        const targets = scope.value === 'current' ? [crop.page] : doc.getPageIndices();
        for (const index of targets) { const page = doc.getPage(index); page.setCropBox(...box); page.setMediaBox(...box); }
        await K.writeOutput(api, output, await doc.save());
        return K.doneNote(api, `Cropped ${targets.length} page(s).`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'action-row' }, [open, save]), status, work]);
    },
  });

  // ---------- Forms ----------

  K.register({
    id: 'forms', name: 'PDF Forms', icon: 'FRM', groups: ['edit'],
    description: 'Fill in existing form fields, or add text boxes, checkboxes and lists to make a fillable PDF.',
    render(api) {
      let source = null;
      const status = h('div');
      const fillArea = h('div', { class: 'pdf-form-fields' });
      const created = [];
      let fieldType = 'text';
      const createdList = h('div', { class: 'pdf-item-list' });
      const viewer = K.pageViewer({
        renderItems() {
          for (const item of created.filter(f => f.page === viewer.state.index)) K.placeBox(viewer, item, h('div', { class: `pdf-field-box ${item.type}`, text: item.name }), { onChange: drawCreated });
        },
        onOverlayDown(event, point, state) {
          K.dragRect(viewer, event, point, rect => {
            const base = { text: 'text', checkbox: 'check', dropdown: 'choice', list: 'list' }[fieldType];
            let n = created.length + 1;
            while (created.some(f => f.name === `${base}_${n}`)) n++;
            created.push({ ...rect, page: state.index, type: fieldType, name: `${base}_${n}`, options: fieldType === 'dropdown' || fieldType === 'list' ? 'Option 1, Option 2' : '' });
            viewer.redraw(); drawCreated();
          });
        },
      });
      const drawCreated = () => {
        clear(createdList);
        if (!created.length) createdList.appendChild(h('span', { class: 'muted', text: 'No new fields yet.' }));
        created.forEach(item => {
          const name = K.textInput(item.name, 'Field name'); name.oninput = () => { item.name = name.value.trim(); };
          const opts = K.textInput(item.options, 'Options, comma separated'); opts.oninput = () => { item.options = opts.value; };
          createdList.appendChild(h('div', { class: 'pdf-form-row' }, [h('span', { class: 'tag', text: `p${item.page + 1} ${item.type}` }), name, item.type === 'dropdown' || item.type === 'list' ? opts : null, h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', onclick: () => { created.splice(created.indexOf(item), 1); viewer.redraw(); drawCreated(); } })]));
        });
      };
      const detect = h('button', { class: 'btn btn-sm', type: 'button', text: 'Detect fields', title: 'Finds blank lines like "Name: ______" and suggests text fields', onclick: async () => {
        let found = 0;
        for (let p = 1; p <= viewer.state.doc.numPages; p++) {
          const page = await viewer.state.doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          for (const item of (await page.getTextContent()).items) {
            const match = /_{4,}|\.{8,}|…{3,}/.exec(item.str || '');
            if (!match) continue;
            const charW = item.width / Math.max(1, item.str.length);
            const [x0, y0] = vp.convertToViewportPoint(item.transform[4] + charW * match.index, item.transform[5]);
            const size = Math.hypot(item.transform[2], item.transform[3]) || 10;
            created.push({ x: x0, y: y0 - size * 1.1, w: Math.max(30, charW * match[0].length), h: size * 1.4, page: p - 1, type: 'text', name: `field_${created.length + 1}`, options: '' });
            found++;
          }
        }
        viewer.redraw(); drawCreated();
        api.toast(found ? `Suggested ${found} field(s); review them before saving.` : 'No blank lines were found.', found ? 'ok' : 'info');
      } });
      const flatten = K.checkbox('Flatten (make the filled values part of the page; fields can no longer be edited)', false);
      const work = h('div', { hidden: true }, [
        h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Fill existing fields' })]), h('div', { class: 'group-body' }, [fillArea, flatten])]),
        h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Add new fields' })]), h('div', { class: 'group-body' }, [
          h('div', { class: 'action-row' }, [K.field('Field type', K.select([['text', 'Text box'], ['checkbox', 'Checkbox'], ['dropdown', 'Dropdown'], ['list', 'List']], fieldType, value => { fieldType = value; })), detect, h('span', { class: 'field-hint', text: 'Drag on the page to place a field.' })]),
          h('div', { class: 'pdf-editor-main' }, [viewer.el, h('div', { class: 'pdf-editor-side' }, [createdList])]),
        ])]),
      ]);
      const values = new Map();
      const open = h('button', { class: 'btn btn-sm', type: 'button', text: 'Open PDF…', onclick: () => K.busy(open, status, 'Opening…', async () => {
        const [file] = await K.pickPdfs(api, false);
        if (!file) return null;
        source = { file, bytes: await K.readBytes(api, file.path) };
        values.clear(); created.length = 0;
        const doc = await K.loadPdfLib(source.bytes);
        const fields = doc.getForm().getFields();
        clear(fillArea);
        if (!fields.length) fillArea.appendChild(h('span', { class: 'muted', text: 'This PDF has no form fields. Add some below.' }));
        for (const f of fields) {
          const name = f.getName();
          let control;
          if (f instanceof PDFTextField) { control = K.textInput(f.getText() || ''); control.oninput = () => values.set(name, control.value); }
          else if (f instanceof PDFCheckBox) { control = h('input', { type: 'checkbox', checked: f.isChecked(), onchange: e => values.set(name, e.target.checked) }); }
          else if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) {
            const current = f instanceof PDFRadioGroup ? f.getSelected() : f.getSelected()[0];
            control = K.select([['', '—'], ...f.getOptions().map(o => [o, o])], current || '', value => values.set(name, value));
          } else continue;
          fillArea.appendChild(h('div', { class: 'pdf-form-row' }, [h('span', { class: 'ellipsis', text: name, title: name }), control]));
        }
        work.hidden = false;
        await viewer.load(source.bytes);
        drawCreated();
        save.disabled = false;
        return null;
      }) });
      const save = h('button', { class: 'btn btn-accent', type: 'button', text: 'Save PDF', disabled: true, onclick: () => K.busy(save, status, 'Saving…', async () => {
        const output = await K.saveAs(api, `${K.stem(source.file.name)}-form.pdf`);
        if (!output) return null;
        const doc = await K.loadPdfLib(source.bytes);
        const form = doc.getForm();
        for (const [name, value] of values) {
          const f = form.getField(name);
          if (f instanceof PDFTextField) { K.checkLatin(value); f.setText(value); }
          else if (f instanceof PDFCheckBox) value ? f.check() : f.uncheck();
          else if (value && (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup)) f.select(value);
        }
        const names = new Set(form.getFields().map(f => f.getName()));
        for (const item of created) {
          if (!item.name || names.has(item.name)) throw new Error(`Field name "${item.name}" is empty or already used`);
          names.add(item.name);
          const jsPage = await viewer.state.doc.getPage(item.page + 1);
          const r = K.toPdfRect(jsPage, item);
          const place = { x: r.x, y: r.y, width: r.width, height: r.height, rotate: r.rotate, borderColor: rgb(0.4, 0.4, 0.45), borderWidth: 1 };
          const page = doc.getPage(item.page);
          const opts = item.options.split(',').map(o => o.trim()).filter(Boolean);
          if (item.type === 'text') form.createTextField(item.name).addToPage(page, place);
          else if (item.type === 'checkbox') form.createCheckBox(item.name).addToPage(page, place);
          else { const field = item.type === 'dropdown' ? form.createDropdown(item.name) : form.createOptionList(item.name); field.addOptions(opts.length ? opts : ['Option 1']); field.addToPage(page, place); }
        }
        if (flatten.input.checked) form.flatten();
        await K.writeOutput(api, output, await doc.save());
        return K.doneNote(api, `Saved${created.length ? ` with ${created.length} new field(s)` : ''}.`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'action-row' }, [open, save]), status, work]);
    },
  });
})();
