// Shared helpers for the PDF Tools add-on: pdf.js/pdf-lib setup, file I/O, page rendering and an interactive page viewer.
(function () {
  const { h, clear, statusNote, fmtBytes } = window.UI;
  const ADDON = 'toolhub-addon://pdf-tools/';
  const { PDFDocument, rgb, degrees, StandardFonts } = window.PDFLib;

  // pdf.js tries a worker first; cross-origin workers are blocked, so it falls back to the
  // in-page worker that vendor/pdfjs/pdf.worker.min.js registers as window.pdfjsWorker.
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${ADDON}vendor/pdfjs/pdf.worker.min.js`;

  const tools = [];
  const GROUPS = [
    { id: 'all', label: 'All' },
    { id: 'organize', label: 'Organize PDF' },
    { id: 'optimize', label: 'Optimize PDF' },
    { id: 'convert', label: 'Convert PDF' },
    { id: 'edit', label: 'Edit PDF' },
    { id: 'security', label: 'PDF Security' },
    { id: 'intelligence', label: 'PDF Intelligence' },
  ];

  const PDF_FILTER = [{ name: 'PDF files', extensions: ['pdf'] }];
  const IMAGE_FILTER = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }];

  function register(tool) { tools.push(tool); }

  function stem(name) { return String(name || 'document').replace(/\.[^.]+$/, ''); }

  async function call(api, action, params) {
    const result = await api.invoke(action, params);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  async function readBytes(api, file) {
    const data = await call(api, 'readFile', { path: file });
    return new Uint8Array(data.bytes);
  }

  async function pickPdfs(api, multiple = true) {
    return (await api.pickFiles({ filters: PDF_FILTER, multiple, title: multiple ? 'Choose PDF files' : 'Choose a PDF' })) || [];
  }

  async function saveAs(api, defaultName, filters = PDF_FILTER) {
    return api.saveFile({ defaultName, filters, title: 'Save as' });
  }

  async function writeOutput(api, output, bytes) {
    return call(api, 'writeFile', { output, bytes });
  }

  async function loadPdfLib(bytes, options = {}) {
    try {
      return await PDFDocument.load(bytes, { updateMetadata: false, ...options });
    } catch (err) {
      if (/encrypted/i.test(err.message)) throw new Error('This PDF is password protected. Unlock it first with Unlock PDF.');
      throw err;
    }
  }

  function openPdfJs(bytes, password) {
    const task = window.pdfjsLib.getDocument({
      data: bytes.slice(),
      password,
      isEvalSupported: false,
      cMapUrl: `${ADDON}vendor/pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${ADDON}vendor/pdfjs/standard_fonts/`,
    });
    return task.promise.catch(err => {
      if (err?.name === 'PasswordException') throw new Error('This PDF is password protected. Unlock it first with Unlock PDF.');
      throw err;
    });
  }

  async function renderPage(pdfPage, scale, canvas = document.createElement('canvas')) {
    const viewport = pdfPage.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    return canvas;
  }

  function canvasBytes(canvas, type = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject) : reject(new Error('Could not encode image')), type, quality));
  }

  // "1-3, 5, 8-" -> [[0,2],[4,4],[7,total-1]] (zero-based, inclusive)
  function parseRanges(text, total) {
    const ranges = [];
    for (const part of String(text || '').split(',').map(p => p.trim()).filter(Boolean)) {
      const m = part.match(/^(\d*)\s*-\s*(\d*)$/) || part.match(/^(\d+)$/);
      if (!m) throw new Error(`"${part}" is not a page or range`);
      const start = m[1] ? Number(m[1]) : 1;
      const end = m.length === 2 ? start : (m[2] ? Number(m[2]) : total);
      if (start < 1 || end > total || start > end) throw new Error(`Pages ${part} are outside 1-${total}`);
      ranges.push([start - 1, end - 1]);
    }
    if (!ranges.length) throw new Error('Enter at least one page or range');
    return ranges;
  }

  function pageList(text, total) {
    if (!String(text || '').trim()) return Array.from({ length: total }, (_, i) => i);
    const set = new Set();
    for (const [a, b] of parseRanges(text, total)) for (let i = a; i <= b; i++) set.add(i);
    return [...set].sort((x, y) => x - y);
  }

  function hexColor(hex) {
    const m = String(hex || '#000000').match(/^#?([0-9a-f]{6})$/i);
    const n = m ? parseInt(m[1], 16) : 0;
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  const FONTS = { Helvetica: StandardFonts.Helvetica, 'Helvetica Bold': StandardFonts.HelveticaBold, Times: StandardFonts.TimesRoman, 'Times Bold': StandardFonts.TimesRomanBold, Courier: StandardFonts.Courier };

  // Standard PDF fonts only cover Latin (WinAnsi) characters; report anything they cannot draw.
  function checkLatin(text) {
    const bad = [...String(text)].filter(ch => ch.charCodeAt(0) > 255 && !'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch));
    if (bad.length) throw new Error(`The built-in PDF fonts cannot draw: ${[...new Set(bad)].join(' ')}`);
  }

  let enginesPromise = null;
  function engines(api, refresh) {
    if (!enginesPromise || refresh) enginesPromise = call(api, 'engines', { refresh: !!refresh }).catch(err => { enginesPromise = null; throw err; });
    return enginesPromise;
  }

  // ---------- small UI building blocks ----------

  function field(label, control, hint) {
    return h('label', { class: 'field pdf-field' }, [h('span', { class: 'field-label', text: label }), control, hint ? h('span', { class: 'field-hint', text: hint }) : null]);
  }

  function select(options, value, onChange) {
    return h('select', { class: 'input', onchange: e => onChange && onChange(e.target.value) }, options.map(([v, label]) => h('option', { value: v, text: label, selected: String(v) === String(value) })));
  }

  function numberInput(value, attrs = {}) {
    return h('input', { class: 'input', type: 'number', value: String(value), ...attrs });
  }

  function textInput(value, placeholder) {
    return h('input', { class: 'input', type: 'text', value: value || '', placeholder: placeholder || '', spellcheck: 'false' });
  }

  function checkbox(label, checked) {
    const box = h('input', { type: 'checkbox', checked: !!checked });
    const wrap = h('label', { class: 'field field-inline' }, [box, h('span', { text: label })]);
    wrap.input = box;
    return wrap;
  }

  // Runs an async job while showing progress, and reports errors in `status`.
  async function busy(button, status, label, job) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    clear(status);
    const report = text => { clear(status); status.appendChild(h('div', { class: 'run-status', text })); };
    try {
      const message = await job(report);
      clear(status);
      if (message) status.appendChild(typeof message === 'string' ? statusNote(message, 'ok') : message);
    } catch (err) {
      clear(status);
      status.appendChild(statusNote(err.message || String(err), 'error'));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function doneNote(api, text, file) {
    return h('div', { class: 'note note-ok pdf-done' }, [h('span', { text }), file ? h('button', { class: 'mini-btn', type: 'button', text: 'Show in folder', onclick: () => api.reveal(file) }) : null]);
  }

  // A reorderable list of chosen files (drag to reorder, or use the arrow buttons).
  function fileList(api, { multiple = true, filters = PDF_FILTER, label = 'Add PDFs', onChange } = {}) {
    const state = { files: [] };
    const listEl = h('div', { class: 'pdf-file-list' });
    let dragIndex = null;
    const draw = () => {
      clear(listEl);
      if (!state.files.length) listEl.appendChild(h('div', { class: 'pdf-drop-hint', text: multiple ? 'No files yet — add some to get started.' : 'No file chosen yet.' }));
      state.files.forEach((file, i) => {
        const row = h('div', { class: 'pdf-file-row', draggable: multiple ? 'true' : null }, [
          h('span', { class: 'pdf-file-index', text: String(i + 1) }),
          h('span', { class: 'pdf-file-name ellipsis', text: file.name, title: file.path }),
          h('span', { class: 'mono muted', text: fmtBytes(file.size) }),
          multiple ? h('button', { class: 'mini-btn', type: 'button', text: '↑', title: 'Move up', disabled: i === 0, onclick: () => { state.files.splice(i - 1, 0, state.files.splice(i, 1)[0]); draw(); } }) : null,
          multiple ? h('button', { class: 'mini-btn', type: 'button', text: '↓', title: 'Move down', disabled: i === state.files.length - 1, onclick: () => { state.files.splice(i + 1, 0, state.files.splice(i, 1)[0]); draw(); } }) : null,
          h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', title: 'Remove', onclick: () => { state.files.splice(i, 1); draw(); } }),
        ]);
        if (multiple) {
          row.addEventListener('dragstart', () => { dragIndex = i; row.classList.add('dragging'); });
          row.addEventListener('dragend', () => row.classList.remove('dragging'));
          row.addEventListener('dragover', event => event.preventDefault());
          row.addEventListener('drop', event => { event.preventDefault(); if (dragIndex === null || dragIndex === i) return; state.files.splice(i, 0, state.files.splice(dragIndex, 1)[0]); dragIndex = null; draw(); });
        }
        listEl.appendChild(row);
      });
      if (onChange) onChange(state.files);
    };
    const add = h('button', { class: 'btn btn-sm', type: 'button', text: multiple ? label : 'Choose file…', onclick: async () => {
      const chosen = await api.pickFiles({ filters, multiple });
      if (!chosen?.length) return;
      state.files = multiple ? [...state.files, ...chosen] : [chosen[0]];
      draw();
    } });
    draw();
    return { el: h('div', { class: 'pdf-files' }, [h('div', { class: 'action-row' }, [add, multiple ? h('span', { class: 'field-hint', text: 'Drag rows to change the order.' }) : null]), listEl]), state, redraw: draw };
  }

  // Shows one page with an overlay for placing items. Item geometry is kept in "view points": the page as
  // displayed (rotation applied) at 1 point = 1 unit, so it can be converted to PDF space with pdf.js.
  function pageViewer({ onOverlayDown, renderItems } = {}) {
    const canvas = h('canvas', { class: 'pdf-view-canvas' });
    const overlay = h('div', { class: 'pdf-view-overlay' });
    const stage = h('div', { class: 'pdf-view-stage' }, [canvas, overlay]);
    const label = h('span', { class: 'muted', text: '' });
    const state = { doc: null, page: null, index: 0, scale: 1, base: null };
    const prev = h('button', { class: 'btn btn-sm', type: 'button', text: '‹ Prev', onclick: () => show(state.index - 1) });
    const next = h('button', { class: 'btn btn-sm', type: 'button', text: 'Next ›', onclick: () => show(state.index + 1) });
    const nav = h('div', { class: 'action-row pdf-view-nav' }, [prev, label, next]);
    const el = h('div', { class: 'pdf-viewer' }, [nav, h('div', { class: 'pdf-view-scroll' }, [stage])]);
    let renderToken = 0;

    async function show(index) {
      if (!state.doc) return;
      const target = Math.max(0, Math.min(state.doc.numPages - 1, index));
      const token = ++renderToken;
      const page = await state.doc.getPage(target + 1);
      if (token !== renderToken) return;
      state.page = page;
      state.index = target;
      state.base = page.getViewport({ scale: 1 });
      const available = Math.max(320, Math.min(980, el.clientWidth - 24 || 760));
      state.scale = available / state.base.width;
      await renderPage(page, state.scale * (window.devicePixelRatio || 1), canvas);
      canvas.style.width = `${state.base.width * state.scale}px`;
      canvas.style.height = `${state.base.height * state.scale}px`;
      stage.style.width = canvas.style.width;
      stage.style.height = canvas.style.height;
      label.textContent = `Page ${target + 1} of ${state.doc.numPages}`;
      prev.disabled = target === 0;
      next.disabled = target === state.doc.numPages - 1;
      redraw();
    }

    function redraw() {
      clear(overlay);
      if (renderItems) renderItems(overlay, state);
    }

    // Converts a pointer event to view points.
    function toView(event) {
      const rect = overlay.getBoundingClientRect();
      return { x: (event.clientX - rect.left) / state.scale, y: (event.clientY - rect.top) / state.scale };
    }

    overlay.addEventListener('pointerdown', event => {
      if (event.target !== overlay || !onOverlayDown) return;
      onOverlayDown(event, toView(event), state);
    });

    return {
      el, overlay, state, show, redraw, toView,
      async load(bytes) { state.doc = await openPdfJs(bytes); await show(0); return state.doc; },
      px: value => value * state.scale,
    };
  }

  // Lets the user drag out a rectangle on the overlay; resolves with the rect in view points.
  function dragRect(viewer, event, start, onDone, cls = 'pdf-sel') {
    const box = h('div', { class: cls });
    viewer.overlay.appendChild(box);
    const move = e => {
      const p = viewer.toView(e);
      const x = Math.min(start.x, p.x), y = Math.min(start.y, p.y);
      Object.assign(box.style, { left: `${viewer.px(x)}px`, top: `${viewer.px(y)}px`, width: `${viewer.px(Math.abs(p.x - start.x))}px`, height: `${viewer.px(Math.abs(p.y - start.y))}px` });
    };
    const up = e => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      box.remove();
      const p = viewer.toView(e);
      const rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      if (rect.w > 2 && rect.h > 2) onDone(rect);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(event);
  }

  // Positions an element over the overlay for a rect given in view points, with drag-to-move and a resize handle.
  function placeBox(viewer, item, el, { onChange, resizable = true, keepRatio = false } = {}) {
    const apply = () => Object.assign(el.style, { left: `${viewer.px(item.x)}px`, top: `${viewer.px(item.y)}px`, width: `${viewer.px(item.w)}px`, height: `${viewer.px(item.h)}px` });
    apply();
    el.classList.add('pdf-item');
    const startDrag = (event, mode) => {
      event.stopPropagation();
      event.preventDefault();
      const start = viewer.toView(event);
      const orig = { ...item };
      const move = e => {
        const p = viewer.toView(e);
        const dx = p.x - start.x, dy = p.y - start.y;
        if (mode === 'move') { item.x = orig.x + dx; item.y = orig.y + dy; }
        else {
          item.w = Math.max(8, orig.w + dx);
          item.h = keepRatio ? item.w * (orig.h / orig.w) : Math.max(8, orig.h + dy);
        }
        apply();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (onChange) onChange(item); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    el.addEventListener('pointerdown', event => startDrag(event, 'move'));
    if (resizable) {
      const handle = h('span', { class: 'pdf-handle' });
      handle.addEventListener('pointerdown', event => startDrag(event, 'resize'));
      el.appendChild(handle);
    }
    viewer.overlay.appendChild(el);
    return el;
  }

  // Converts a rect in view points on a pdf.js page into PDF user space: the visual bottom-left anchor,
  // size, and the rotation pdf-lib needs so the drawing appears upright on rotated pages.
  function toPdfRect(pdfjsPage, rect) {
    const vp = pdfjsPage.getViewport({ scale: 1 });
    const [ax, ay] = vp.convertToPdfPoint(rect.x, rect.y + rect.h);
    const rotation = pdfjsPage.rotate || 0;
    return { x: ax, y: ay, width: rect.w, height: rect.h, rotate: degrees(rotation) };
  }

  function toPdfPoint(pdfjsPage, x, y) {
    return pdfjsPage.getViewport({ scale: 1 }).convertToPdfPoint(x, y);
  }

  async function imageToEmbeddable(bytes, name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return { kind: 'jpg', bytes };
    if (ext === 'png') return { kind: 'png', bytes };
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return { kind: 'png', bytes: await canvasBytes(canvas, 'image/png') };
  }

  async function embedImage(doc, image) {
    return image.kind === 'jpg' ? doc.embedJpg(image.bytes) : doc.embedPng(image.bytes);
  }

  function engineNote(text, links) {
    return h('div', { class: 'note note-warn' }, [
      h('span', { text: `${text} ` }),
      ...links.map(([label, url]) => h('a', { class: 'pdf-link', href: url, target: '_blank', rel: 'noreferrer', text: label })),
    ]);
  }

  window.PdfKit = {
    ADDON, GROUPS, tools, register, call, readBytes, pickPdfs, saveAs, writeOutput, loadPdfLib, openPdfJs, renderPage, canvasBytes,
    parseRanges, pageList, hexColor, FONTS, checkLatin, engines, field, select, numberInput, textInput, checkbox, busy, doneNote,
    fileList, pageViewer, dragRect, placeBox, toPdfRect, toPdfPoint, imageToEmbeddable, embedImage, engineNote, stem,
    PDF_FILTER, IMAGE_FILTER,
  };
})();
