(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('image-privacy', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    let folder = '', images = [];
    const mode = h('select', { class: 'input' }, [h('option', { value: 'strip', text: 'Strip metadata (re-encode)' }), h('option', { value: 'watermark', text: 'Add visible watermark' }), h('option', { value: 'pdf', text: 'Create PDF from images' })]);
    const watermark = h('input', { class: 'input', type: 'text', placeholder: 'Watermark text' });
    const dryRun = h('input', { type: 'checkbox', checked: true });
    const choose = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose folder', onclick: async () => { const selected = await api.pickFolder('Choose image folder'); if (selected) { folder = selected; const res = await api.invoke('listImages', { folder, recursive: true }); if (!res.ok) api.toast(res.error, 'error'); else { images = res.data.files.filter(file => ['jpg', 'jpeg', 'png', 'webp'].includes(file.ext)); api.toast(`Found ${images.length} supported image(s)`, 'ok'); renderRows(); } } } });
    function renderRows() { clear(results); results.appendChild(h('div', { class: 'stat-row' }, [stat('Images', fmtNumber(images.length))])); if (!images.length) { results.appendChild(empty('Choose a folder with JPEG, PNG or WebP images.')); return; } results.appendChild(table([{ label: 'Image', width: 'minmax(0,1fr)' }, { label: 'Size', width: '100px' }], images.map(file => h('div', { class: 'tbl-row' }, [h('span', { class: 'ellipsis', text: file.name, title: file.path }), h('span', { class: 'mono', text: fmtBytes(file.size) })])))); }
    const process = h('button', { class: 'btn btn-accent', type: 'button', text: 'Process images', onclick: async () => {
      if (!images.length) { api.toast('Choose an image folder first', 'error'); return; }
      if (mode.value === 'pdf') { try { const bytes = await makeImagePdf(images, api); window.UI.downloadFile('images.pdf', bytes, 'application/pdf'); api.toast('PDF created', 'ok'); } catch (err) { api.toast(err.message, 'error'); } return; }
      const text = watermark.value.trim(); if (mode.value === 'watermark' && !text) { api.toast('Enter watermark text', 'error'); return; }
      if (!window.confirm(mode.value === 'strip' ? `Re-encode ${images.length} image(s) in place to remove embedded metadata?` : `Add a visible watermark to ${images.length} image(s) in place?`)) return;
      process.disabled = true; let done = 0, failed = 0;
      for (const file of images) {
        try {
          const read = await api.invoke('read', { path: file.path }); if (!read.ok) throw new Error(read.error);
          const img = await loadImage(read.data.dataUrl), canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          if (mode.value === 'watermark') { const size = Math.max(18, Math.round(canvas.width / 28)); ctx.font = `bold ${size}px sans-serif`; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.fillRect(canvas.width * .55, canvas.height - size * 2.2, canvas.width * .42, size * 1.8); ctx.fillStyle = '#fff'; ctx.fillText(text, canvas.width - size, canvas.height - size * .35, canvas.width * .4); }
          const mime = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[file.ext]; const dataUrl = canvas.toDataURL(mime, .94);
          if (!dryRun.checked) { const saved = await api.invoke('write', { dir: file.path.slice(0, file.path.length - file.name.length), name: file.name, dataUrl, overwrite: true }); if (!saved.ok) throw new Error(saved.error); }
          done++;
        } catch { failed++; }
      }
      process.disabled = false; api.toast(`${dryRun.checked ? 'Previewed' : 'Processed'} ${done}; ${failed} failed${dryRun.checked ? ' · nothing saved' : ''}`, failed ? 'warn' : 'ok');
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Image Privacy & Watermark' }), h('p', { class: 'tool-desc', text: 'Re-encoding JPEG, PNG and WebP removes embedded metadata. Watermarking edits originals in place; keep a copy if needed.' })]));
    root.appendChild(h('div', { class: 'field-row' }, [choose, mode, watermark, h('label', { class: 'field field-inline' }, [dryRun, h('span', { text: 'Preview only' })]), process])); root.appendChild(results); return root;
  } });

  function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Could not read image')); image.src = src; }); }

  async function makeImagePdf(images, api) {
    const objects = [], pages = [];
    for (let i = 0; i < images.length; i++) {
      const item = images[i], result = await api.invoke('read', { path: item.path }); if (!result.ok) throw new Error(result.error);
      const img = await loadImage(result.data.dataUrl), canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; canvas.getContext('2d').drawImage(img, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', .94).split(',')[1], binary = atob(base64), pageId = 3 + i * 3, imageId = pageId + 1, contentId = pageId + 2;
      pages.push(pageId);
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${img.naturalWidth} ${img.naturalHeight}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[imageId] = `<< /Type /XObject /Subtype /Image /Width ${img.naturalWidth} /Height ${img.naturalHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${binary.length} >>\nstream\n${binary}\nendstream`;
      const content = `q ${img.naturalWidth} 0 0 ${img.naturalHeight} 0 0 cm /Im0 Do Q`;
      objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    }
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] >>`;
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offsets = [0];
    for (let id = 1; id < objects.length; id++) { offsets[id] = pdf.length; pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
    const xref = pdf.length; pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([new Uint8Array(Array.from(pdf, c => c.charCodeAt(0) & 255))], { type: 'application/pdf' });
  }
})();
