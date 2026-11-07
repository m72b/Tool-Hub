// Screenshot & Capture screen.
(function () {
  const { h, clear, statusNote, fmtBytes, fmtDate, fmtNumber, empty } = window.UI;
  const MODES = { region: 'Region', window: 'Window', screen: 'Full screen', scroll: 'Scrolling' };

  window.Hub.registerView('capture-toolkit', {
    render(api) {
      const status = h('div');
      const picker = h('div', { class: 'cap-picker', hidden: true });
      const body = h('div');
      const delay = h('select', { class: 'input cap-delay', title: 'Wait before capturing' }, [[0, 'No delay'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds']].map(([value, label]) => h('option', { value: String(value), text: label })));

      async function capture(mode, extra = {}) {
        clear(status);
        picker.hidden = true;
        const res = await api.invoke('capture', { mode, delay: Number(delay.value), ...extra });
        if (!res.ok) { status.appendChild(statusNote(res.error, 'error')); return; }
        if (!res.data) return;
        if (res.data.skipped) status.appendChild(statusNote(`${res.data.skipped} of ${res.data.frames} frames could not be joined. Scroll more slowly for a complete image.`, 'warn'));
        openEditor(res.data.item.id);
      }

      async function choose(mode) {
        clear(picker);
        picker.hidden = false;
        picker.appendChild(h('div', { class: 'muted', text: 'Finding what can be captured…' }));
        const res = await api.invoke('sources', {});
        clear(picker);
        if (!res.ok) { picker.appendChild(statusNote(res.error, 'error')); return; }
        if (mode === 'screen') {
          if (res.data.displays.length === 1) { capture('screen', { display: res.data.displays[0].id }); return; }
          for (const display of res.data.displays) picker.appendChild(h('button', { class: 'cap-source', type: 'button', onclick: () => capture('screen', { display: display.id }) }, [h('span', { text: `${display.name} (${display.width} × ${display.height})` })]));
          return;
        }
        if (!res.data.windows.length) picker.appendChild(empty('No windows found.'));
        for (const win of res.data.windows) picker.appendChild(h('button', { class: 'cap-source', type: 'button', title: win.name, onclick: () => capture('window', { source: win.id }) }, [h('img', { src: win.thumb, alt: '' }), h('span', { class: 'ellipsis', text: win.name })]));
      }

      async function showHistory() {
        clear(body);
        const res = await api.invoke('history', {});
        if (!res.ok) { body.appendChild(statusNote(res.error, 'error')); return; }
        const { items, totalSize } = res.data;
        body.appendChild(h('div', { class: 'action-row cap-history-head' }, [
          h('span', { class: 'muted', text: `${fmtNumber(items.length)} ${items.length === 1 ? 'capture' : 'captures'} · ${fmtBytes(totalSize)}` }),
          items.length ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Delete all', onclick: async () => {
            if (!window.confirm(`Delete all ${items.length} captures? This cannot be undone.`)) return;
            await api.invoke('clear', {});
            showHistory();
          } }) : null,
        ]));
        if (!items.length) { body.appendChild(empty('Your captures appear here. They stay on this PC.')); return; }
        body.appendChild(h('div', { class: 'cap-grid' }, items.map(item => h('button', { class: 'cap-card', type: 'button', onclick: () => openEditor(item.id) }, [
          h('img', { src: item.thumb, alt: item.name }),
          h('span', { class: 'cap-card-name ellipsis', text: item.name || MODES[item.mode] }),
          h('span', { class: 'muted cap-card-meta', text: `${item.width} × ${item.height} · ${fmtDate(item.createdAt)}` }),
        ]))));
      }

      async function saveEdits(editor, item) {
        if (!editor.changed()) return item;
        const res = await api.invoke('saveEdited', { id: item.id, image: editor.result() });
        if (!res.ok) { api.toast(res.error, 'error'); return null; }
        return res.data;
      }

      async function openEditor(id) {
        clear(body);
        const res = await api.invoke('open', { id });
        if (!res.ok) { body.appendChild(statusNote(res.error, 'error')); return; }
        const item = res.data;
        const editor = window.CaptureEditor(item.image);
        const textBox = h('textarea', { class: 'input cap-ocr', rows: '8', spellcheck: 'false', hidden: true, readonly: true });

        const save = async () => {
          const saved = await saveEdits(editor, item);
          if (saved && saved.id !== item.id) { api.toast('Saved as a new capture', 'ok'); openEditor(saved.id); }
          return saved;
        };
        const act = async work => { const saved = editor.changed() ? await saveEdits(editor, item) : item; if (saved) await work(saved); };

        body.append(
          h('div', { class: 'action-row cap-actions' }, [
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Back to history', onclick: showHistory }),
            h('button', { class: 'btn btn-sm btn-accent', type: 'button', text: 'Save copy', title: 'Keeps the original', onclick: save }),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy', onclick: () => act(async saved => { const r = await api.invoke('copy', { id: saved.id }); api.toast(r.ok ? 'Copied to the clipboard' : r.error, r.ok ? 'ok' : 'error'); }) }),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Export', onclick: () => act(async saved => {
              const output = await api.saveFile({ defaultName: `capture-${saved.id.slice(0, 6)}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg'] }], title: 'Export the capture' });
              if (!output) return;
              const r = await api.invoke('exportImage', { id: saved.id, output });
              api.toast(r.ok ? 'Exported' : r.error, r.ok ? 'ok' : 'error');
            }) }),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Extract text', onclick: () => act(async saved => {
              textBox.hidden = false;
              textBox.value = 'Reading text…';
              const r = await api.invoke('ocr', { id: saved.id });
              textBox.value = r.ok ? (r.data.text || 'No text found.') : r.error;
            }) }),
            h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete', onclick: async () => {
              if (!window.confirm('Delete this capture? This cannot be undone.')) return;
              await api.invoke('remove', { id: item.id });
              showHistory();
            } }),
            h('span', { class: 'muted cap-meta', text: `${item.width} × ${item.height} · ${fmtBytes(item.size)}` }),
          ]),
          editor.toolbar, textBox,
          h('div', { class: 'cap-stage' }, [editor.canvas]),
        );
      }

      showHistory();
      return h('div', { class: 'tool' }, [
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Screenshot & Capture' }), h('p', { class: 'tool-desc', text: 'Capture your screen, then annotate, blur and read text from it. Tool Hub hides itself while capturing.' })]),
        h('div', { class: 'action-row' }, [
          h('button', { class: 'btn btn-accent', type: 'button', text: 'Region', onclick: () => capture('region') }),
          h('button', { class: 'btn', type: 'button', text: 'Window', onclick: () => choose('window') }),
          h('button', { class: 'btn', type: 'button', text: 'Full screen', onclick: () => choose('screen') }),
          h('button', { class: 'btn', type: 'button', text: 'Scrolling', title: 'Select an area, then scroll it slowly yourself', onclick: () => capture('scroll') }),
          delay,
        ]),
        status, picker, body,
      ]);
    },
  });
})();
