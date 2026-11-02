// PDF Security: protect, unlock, sign, redact.
(function () {
  const { h, clear, statusNote } = window.UI;
  const K = window.PdfKit;
  const { PDFDocument } = window.PDFLib;

  async function requireQpdf(api) {
    const found = await K.engines(api);
    if (!found.qpdf) throw new Error('The password engine (qpdf) is missing. Reinstall the PDF Tools add-on.');
  }

  K.register({
    id: 'protect', name: 'Protect PDF', icon: 'LCK', groups: ['security'],
    description: 'Encrypt a PDF with a password (AES-256) and optionally limit printing, copying and editing.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const password = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Password to open the PDF' });
      const confirm = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
      const restrict = K.checkbox('Also restrict what people can do after opening it', false);
      const owner = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Permissions password (needed to lift the limits)' });
      const allow = { print: K.checkbox('Allow printing', true), copy: K.checkbox('Allow copying text and images', false), modify: K.checkbox('Allow editing', false), annotate: K.checkbox('Allow comments', true), forms: K.checkbox('Allow filling forms', true) };
      const perms = h('div', { class: 'pdf-options', hidden: true }, [K.field('Permissions password', owner), ...Object.values(allow)]);
      restrict.input.addEventListener('change', () => { perms.hidden = !restrict.input.checked; });
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Protect PDF', onclick: () => K.busy(run, status, 'Encrypting…', async () => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        if (!password.value) throw new Error('Enter a password');
        if (password.value !== confirm.value) throw new Error('The passwords do not match');
        if (restrict.input.checked && !owner.value) throw new Error('Enter a permissions password, or untick the restrictions');
        if (restrict.input.checked && owner.value === password.value) throw new Error('Use a different permissions password than the open password');
        await requireQpdf(api);
        const output = await K.saveAs(api, `${K.stem(chosen.name)}-protected.pdf`);
        if (!output) return null;
        await K.call(api, 'qpdf', {
          operation: 'encrypt', path: chosen.path, output, userPassword: password.value,
          ownerPassword: restrict.input.checked ? owner.value : '',
          allow: restrict.input.checked ? Object.fromEntries(Object.entries(allow).map(([k, v]) => [k, v.input.checked])) : {},
        });
        password.value = confirm.value = owner.value = '';
        return K.doneNote(api, 'Protected with AES-256 encryption. Keep the password safe — it cannot be recovered.', output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, h('div', { class: 'pdf-options' }, [K.field('Password', password), K.field('Repeat password', confirm), restrict]), perms, h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  K.register({
    id: 'unlock', name: 'Unlock PDF', icon: 'UNL', groups: ['security'],
    description: 'Remove the password and restrictions from a PDF you have the password for.',
    render(api) {
      const file = K.fileList(api, { multiple: false });
      const password = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Leave empty if it only has editing restrictions' });
      const status = h('div');
      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Unlock PDF', onclick: () => K.busy(run, status, 'Unlocking…', async () => {
        const chosen = file.state.files[0];
        if (!chosen) throw new Error('Choose a PDF first');
        await requireQpdf(api);
        const output = await K.saveAs(api, `${K.stem(chosen.name)}-unlocked.pdf`);
        if (!output) return null;
        await K.call(api, 'qpdf', { operation: 'decrypt', path: chosen.path, output, password: password.value });
        password.value = '';
        return K.doneNote(api, 'Saved an unlocked copy without a password.', output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [file.el, h('div', { class: 'pdf-options' }, [K.field('Password', password)]), statusNote('Only unlock files you own or are allowed to change.', 'info'), h('div', { class: 'action-row' }, [run]), status]);
    },
  });

  // ---------- Sign ----------

  function signatureDialog(api, onReady) {
    let mode = 'draw';
    const bg = h('div', { class: 'modal-bg open' });
    const body = h('div');
    const color = h('input', { class: 'pdf-color', type: 'color', value: '#1b2a6b' });
    const close = () => bg.remove();
    const draw = () => {
      clear(body);
      if (mode === 'draw') {
        const pad = h('canvas', { class: 'pdf-sign-pad', width: '600', height: '200' });
        const ctx = pad.getContext('2d');
        ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        let drawing = false, empty = true;
        const pos = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
        pad.addEventListener('pointerdown', e => { drawing = true; empty = false; ctx.strokeStyle = color.value; ctx.beginPath(); ctx.moveTo(...pos(e)); pad.setPointerCapture(e.pointerId); });
        pad.addEventListener('pointermove', e => { if (drawing) { ctx.lineTo(...pos(e)); ctx.stroke(); } });
        pad.addEventListener('pointerup', () => { drawing = false; });
        body.appendChild(pad);
        body.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Clear', onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); empty = true; } }), h('button', { class: 'btn btn-accent', type: 'button', text: 'Use signature', onclick: async () => { if (empty) return; await onReady(await K.canvasBytes(trim(pad), 'image/png')); close(); } })]));
      } else if (mode === 'type') {
        const name = K.textInput('', 'Your name');
        const preview = h('div', { class: 'pdf-sign-typed', text: 'Your name' });
        name.oninput = () => { preview.textContent = name.value || 'Your name'; preview.style.color = color.value; };
        body.appendChild(name);
        body.appendChild(preview);
        body.appendChild(h('button', { class: 'btn btn-accent', type: 'button', text: 'Use signature', onclick: async () => {
          if (!name.value.trim()) return;
          const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 220;
          const ctx = canvas.getContext('2d');
          ctx.font = '120px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
          ctx.fillStyle = color.value; ctx.textBaseline = 'middle';
          ctx.fillText(name.value.trim(), 20, 115, 860);
          await onReady(await K.canvasBytes(trim(canvas), 'image/png'));
          close();
        } }));
      } else {
        body.appendChild(h('button', { class: 'btn', type: 'button', text: 'Choose image…', onclick: async () => {
          const chosen = await api.pickFiles({ filters: K.IMAGE_FILTER, multiple: false });
          if (!chosen?.length) return;
          const image = await K.imageToEmbeddable(await K.readBytes(api, chosen[0].path), chosen[0].name);
          await onReady(image.bytes, image.kind === 'jpg' ? 'signature.jpg' : 'signature.png');
          close();
        } }));
        body.appendChild(h('p', { class: 'field-hint', text: 'A PNG with a transparent background looks best.' }));
      }
    };
    const tabs = h('div', { class: 'pdf-modes' }, ['draw', 'type', 'upload'].map(m => h('button', { class: `settings-mode-btn${m === mode ? ' active' : ''}`, type: 'button', text: { draw: 'Draw', type: 'Type', upload: 'Upload' }[m], onclick: e => { mode = m; tabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === e.currentTarget)); draw(); } })));
    bg.appendChild(h('div', { class: 'modal-box' }, [h('div', { class: 'modal-title', text: 'Create your signature' }), tabs, K.field('Ink colour', color), body, h('button', { class: 'btn btn-sm', type: 'button', text: 'Cancel', onclick: close })]));
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    draw();
  }

  // Crops a canvas to its non-transparent content.
  function trim(canvas) {
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 <= x0 || y1 <= y0) return canvas;
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 8; out.height = y1 - y0 + 8;
    out.getContext('2d').drawImage(canvas, x0 - 4, y0 - 4, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  K.annotatorTool({
    id: 'sign', name: 'Sign PDF', icon: 'SGN', groups: ['security', 'edit'], suffix: 'signed', applyLabel: 'Save signed PDF',
    description: 'Draw, type or upload your signature and place it on the document.',
    tools: ['select', 'image', 'text'],
    extra: (api, getAnn) => [
      h('button', { class: 'btn btn-sm btn-accent', type: 'button', text: 'Create signature…', onclick: () => signatureDialog(api, async (bytes, name = 'signature.png') => {
        await getAnn().useImage(bytes, name, { label: 'signature' });
        getAnn().setMode('image');
        api.toast('Click the page where the signature should go', 'info');
      }) }),
      h('span', { class: 'field-hint', text: 'This adds a visible signature. It is not a certificate-based digital signature.' }),
    ],
  });

  // ---------- Redact ----------

  K.register({
    id: 'redact', name: 'Redact PDF', icon: 'RED', groups: ['security'],
    description: 'Black out text and graphics so the hidden content is permanently removed.',
    render(api) {
      let source = null;
      const boxes = [];
      const status = h('div');
      const list = h('div', { class: 'pdf-item-list' });
      const drawList = () => {
        clear(list);
        if (!boxes.length) list.appendChild(h('span', { class: 'muted', text: 'No redactions yet.' }));
        boxes.forEach(box => list.appendChild(h('div', { class: 'pdf-item-row' }, [h('span', { class: 'ellipsis', text: `p${box.page + 1}${box.label ? ` · ${box.label}` : ''}` }), h('button', { class: 'mini-btn', type: 'button', text: 'Go to', onclick: () => viewer.show(box.page) }), h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', onclick: () => { boxes.splice(boxes.indexOf(box), 1); viewer.redraw(); drawList(); } })])));
      };
      const viewer = K.pageViewer({
        renderItems() { for (const box of boxes.filter(b => b.page === viewer.state.index)) K.placeBox(viewer, box, h('div', { class: 'pdf-redact-box' }), { onChange: drawList }); },
        onOverlayDown(event, point, state) { K.dragRect(viewer, event, point, rect => { boxes.push({ ...rect, page: state.index }); viewer.redraw(); drawList(); }, 'pdf-redact-box'); },
      });
      const search = K.textInput('', 'Find text to redact everywhere (e.g. a name or account number)');
      const findBtn = h('button', { class: 'btn btn-sm', type: 'button', text: 'Mark all matches', onclick: async () => {
        const query = search.value.trim().toLowerCase();
        if (!query || !viewer.state.doc) return;
        let found = 0;
        for (let p = 1; p <= viewer.state.doc.numPages; p++) {
          const page = await viewer.state.doc.getPage(p);
          const vp = page.getViewport({ scale: 1 });
          for (const item of (await page.getTextContent()).items) {
            const text = (item.str || '').toLowerCase();
            const size = Math.hypot(item.transform[2], item.transform[3]) || 10;
            const charW = item.width / Math.max(1, item.str.length);
            for (let at = text.indexOf(query); at >= 0; at = text.indexOf(query, at + query.length)) {
              const [ax, ay] = vp.convertToViewportPoint(item.transform[4] + charW * at, item.transform[5] - size * 0.25);
              const [bx, by] = vp.convertToViewportPoint(item.transform[4] + charW * (at + query.length), item.transform[5] + size * 0.95);
              boxes.push({ x: Math.min(ax, bx) - 1, y: Math.min(ay, by) - 1, w: Math.abs(bx - ax) + 2, h: Math.abs(by - ay) + 2, page: p - 1, label: search.value.trim() });
              found++;
            }
          }
        }
        viewer.redraw(); drawList();
        api.toast(found ? `Marked ${found} match(es)` : 'No matches found', found ? 'ok' : 'info');
      } });
      const clean = K.checkbox('Also remove document properties (title, author, keywords)', true);
      const work = h('div', { class: 'pdf-editor', hidden: true }, [
        h('div', { class: 'action-row' }, [search, findBtn]),
        h('div', { class: 'pdf-editor-main' }, [viewer.el, h('div', { class: 'pdf-editor-side' }, [h('div', { class: 'group-title', text: 'Redactions' }), list, clean])]),
      ]);
      const open = h('button', { class: 'btn btn-sm', type: 'button', text: 'Open PDF…', onclick: () => K.busy(open, status, 'Opening…', async () => {
        const [file] = await K.pickPdfs(api, false);
        if (!file) return null;
        source = { file, bytes: await K.readBytes(api, file.path) };
        boxes.length = 0;
        work.hidden = false;
        await viewer.load(source.bytes);
        drawList();
        save.disabled = false;
        return null;
      }) });
      const save = h('button', { class: 'btn btn-danger', type: 'button', text: 'Apply redactions', disabled: true, onclick: () => K.busy(save, status, 'Redacting…', async report => {
        if (!boxes.length) throw new Error('Drag on the page to mark areas, or search for text');
        const output = await K.saveAs(api, `${K.stem(source.file.name)}-redacted.pdf`);
        if (!output) return null;
        const original = await K.loadPdfLib(source.bytes);
        const doc = await PDFDocument.create();
        const pagesWithBoxes = new Set(boxes.map(b => b.page));
        for (let i = 0; i < original.getPageCount(); i++) {
          if (!pagesWithBoxes.has(i)) { const [copy] = await doc.copyPages(original, [i]); doc.addPage(copy); continue; }
          report(`Redacting page ${i + 1}…`);
          // The whole page becomes an image so the covered text and graphics are truly gone.
          const jsPage = await viewer.state.doc.getPage(i + 1);
          const scale = 200 / 72;
          const canvas = await K.renderPage(jsPage, scale);
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000';
          for (const box of boxes.filter(b => b.page === i)) ctx.fillRect(box.x * scale, box.y * scale, box.w * scale, box.h * scale);
          const base = jsPage.getViewport({ scale: 1 });
          const image = await doc.embedJpg(await K.canvasBytes(canvas, 'image/jpeg', 0.9));
          doc.addPage([base.width, base.height]).drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
        }
        if (!clean.input.checked) { doc.setTitle(original.getTitle() || ''); doc.setAuthor(original.getAuthor() || ''); }
        await K.writeOutput(api, output, await doc.save());
        return K.doneNote(api, `Redacted ${boxes.length} area(s) on ${pagesWithBoxes.size} page(s). Those pages are now images; other pages are unchanged.`, output);
      }) });
      return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'action-row' }, [open, save]), status, work]);
    },
  });
})();
