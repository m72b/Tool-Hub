// PDF Intelligence: compare two versions of a document.
(function () {
  const { h, clear, statusNote } = window.UI;
  const K = window.PdfKit;

  function lineDiff(a, b) {
    if (a.length * b.length > 4e6) return { added: b, removed: a, tooBig: true };
    const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ op: ' ', text: a[i] }); i++; j++; }
      else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) ops.push({ op: '+', text: b[j++] });
      else ops.push({ op: '-', text: a[i++] });
    }
    return { ops };
  }

  async function pageLines(pdfjs, index) {
    if (index >= pdfjs.numPages) return [];
    const content = await (await pdfjs.getPage(index + 1)).getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const key = Math.round(item.transform[5] / 3);
      rows.set(key, [...(rows.get(key) || []), item]);
    }
    return [...rows.entries()].sort((x, y) => y[0] - x[0]).map(([, items]) => items.sort((p, q) => p.transform[4] - q.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim());
  }

  K.register({
    id: 'compare', name: 'Compare PDF', icon: 'CMP', groups: ['intelligence'],
    description: 'Show two versions side by side and highlight what changed, page by page.',
    render(api) {
      const left = K.fileList(api, { multiple: false });
      const right = K.fileList(api, { multiple: false });
      const status = h('div');
      const view = h('div', { class: 'pdf-compare', hidden: true });
      const state = { a: null, b: null, index: 0, pages: 0 };
      const label = h('span', { class: 'muted' });
      const summary = h('div');
      const leftCanvas = h('div', { class: 'pdf-compare-pane' });
      const rightCanvas = h('div', { class: 'pdf-compare-pane' });
      const textOut = h('div', { class: 'log pdf-diff' });
      const highlight = K.checkbox('Highlight visual differences', true);
      highlight.input.addEventListener('change', () => show(state.index));

      async function renderSide(doc, index, width) {
        if (index >= doc.numPages) return null;
        const page = await doc.getPage(index + 1);
        return K.renderPage(page, width / page.getViewport({ scale: 1 }).width);
      }

      async function show(index) {
        state.index = Math.max(0, Math.min(state.pages - 1, index));
        label.textContent = `Page ${state.index + 1} of ${state.pages}`;
        prev.disabled = state.index === 0;
        next.disabled = state.index >= state.pages - 1;
        const width = Math.max(260, Math.min(560, (view.clientWidth - 40) / 2 || 420)) * (window.devicePixelRatio || 1);
        const [ca, cb] = await Promise.all([renderSide(state.a, state.index, width), renderSide(state.b, state.index, width)]);
        clear(leftCanvas); clear(rightCanvas);
        leftCanvas.appendChild(ca || h('div', { class: 'pdf-blank', text: 'No page here' }));
        rightCanvas.appendChild(cb || h('div', { class: 'pdf-blank', text: 'No page here' }));
        if (ca && cb && highlight.input.checked) {
          const w = Math.min(ca.width, cb.width), hgt = Math.min(ca.height, cb.height);
          const da = ca.getContext('2d').getImageData(0, 0, w, hgt), db = cb.getContext('2d').getImageData(0, 0, w, hgt);
          const marks = [ca, cb].map(c => { const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; o.className = 'pdf-diff-layer'; return o; });
          const mark = marks.map(m => m.getContext('2d'));
          mark.forEach(m => { m.fillStyle = 'rgba(255, 60, 60, 0.45)'; });
          const cell = 6;
          for (let y = 0; y < hgt; y += cell) for (let x = 0; x < w; x += cell) {
            let diff = 0;
            for (let yy = y; yy < Math.min(y + cell, hgt) && !diff; yy++) for (let xx = x; xx < Math.min(x + cell, w); xx++) {
              const p = (yy * w + xx) * 4;
              if (Math.abs(da.data[p] - db.data[p]) + Math.abs(da.data[p + 1] - db.data[p + 1]) + Math.abs(da.data[p + 2] - db.data[p + 2]) > 90) { diff = 1; break; }
            }
            if (diff) mark.forEach(m => m.fillRect(x, y, cell, cell));
          }
          leftCanvas.appendChild(marks[0]);
          rightCanvas.appendChild(marks[1]);
        }
        const [la, lb] = await Promise.all([pageLines(state.a, state.index), pageLines(state.b, state.index)]);
        const result = lineDiff(la, lb);
        clear(textOut);
        const changes = result.ops ? result.ops.filter(op => op.op !== ' ') : [...result.removed.map(text => ({ op: '-', text })), ...result.added.map(text => ({ op: '+', text }))];
        if (!changes.length) textOut.appendChild(h('div', { class: 'log-line', text: 'No text changes on this page.' }));
        for (const change of changes.slice(0, 400)) textOut.appendChild(h('div', { class: `log-line ${change.op === '+' ? 'pdf-added' : 'pdf-removed'}`, text: `${change.op === '+' ? '+ ' : '− '}${change.text}` }));
      }

      const prev = h('button', { class: 'btn btn-sm', type: 'button', text: '‹ Prev', onclick: () => show(state.index - 1) });
      const next = h('button', { class: 'btn btn-sm', type: 'button', text: 'Next ›', onclick: () => show(state.index + 1) });
      view.append(h('div', { class: 'action-row' }, [prev, label, next, highlight]), summary, h('div', { class: 'pdf-compare-grid' }, [h('div', {}, [h('div', { class: 'group-title', text: 'Original' }), leftCanvas]), h('div', {}, [h('div', { class: 'group-title', text: 'Changed' }), rightCanvas])]), h('div', { class: 'group-title', text: 'Text changes on this page' }), textOut);

      const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Compare', onclick: () => K.busy(run, status, 'Comparing…', async report => {
        const a = left.state.files[0], b = right.state.files[0];
        if (!a || !b) throw new Error('Choose both PDFs');
        state.a = await K.openPdfJs(await K.readBytes(api, a.path));
        state.b = await K.openPdfJs(await K.readBytes(api, b.path));
        state.pages = Math.max(state.a.numPages, state.b.numPages);
        const changed = [];
        for (let i = 0; i < state.pages; i++) {
          report(`Checking text on page ${i + 1}…`);
          const [la, lb] = await Promise.all([pageLines(state.a, i), pageLines(state.b, i)]);
          if (la.join('\n') !== lb.join('\n')) changed.push(i + 1);
        }
        clear(summary);
        summary.appendChild(statusNote(changed.length ? `Text differs on page(s): ${changed.slice(0, 40).join(', ')}${changed.length > 40 ? '…' : ''}.` : 'The text of both documents is identical. Visual differences (images, layout) are highlighted per page.', changed.length ? 'warn' : 'ok'));
        if (state.a.numPages !== state.b.numPages) summary.appendChild(statusNote(`The original has ${state.a.numPages} page(s); the changed version has ${state.b.numPages}.`, 'info'));
        view.hidden = false;
        await show(changed.length ? changed[0] - 1 : 0);
        return null;
      }) });
      return h('div', { class: 'pdf-tool-body' }, [h('div', { class: 'pdf-compare-pick' }, [h('div', {}, [h('div', { class: 'group-title', text: 'Original PDF' }), left.el]), h('div', {}, [h('div', { class: 'group-title', text: 'Changed PDF' }), right.el])]), h('div', { class: 'action-row' }, [run]), status, view]);
    },
  });
})();
