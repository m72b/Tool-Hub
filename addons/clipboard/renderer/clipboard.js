// Clipboard Manager screen.
(function () {
  const { h, clear, statusNote, fmtBytes, fmtNumber, empty } = window.UI;
  const FILTERS = [['all', 'All'], ['text', 'Text'], ['image', 'Images'], ['files', 'Files'], ['pinned', 'Pinned'], ['favorite', 'Favorites']];
  const RETENTION = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '1 year'], [0, 'Keep forever']];

  function when(ms) {
    const minutes = Math.floor((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
    return new Date(ms).toLocaleDateString();
  }

  window.Hub.registerView('clipboard-manager', {
    render(api) {
      const view = { type: 'all', collection: '', query: '', revision: -1, status: null };
      const root = h('div', { class: 'tool' });
      const toggle = h('button', { class: 'btn btn-accent', type: 'button', text: 'Start monitoring', onclick: async () => {
        const res = await api.invoke('setMonitoring', { enabled: !view.status?.monitoring });
        if (!res.ok) { api.toast(res.error, 'error'); return; }
        view.status = res.data;
        drawStatus();
      } });
      const statusText = h('span', { class: 'muted' });
      const notice = h('div');
      const search = h('input', { class: 'input', type: 'search', placeholder: 'Search your clipboard history…', spellcheck: 'false', oninput: e => { view.query = e.target.value; refresh(); } });
      const filters = h('div', { class: 'clip-filters' });
      const collectionSelect = h('select', { class: 'input clip-collection-filter', onchange: e => { view.collection = e.target.value; refresh(); } });
      const summary = h('div', { class: 'muted clip-summary' });
      const listEl = h('div', { class: 'clip-list' });

      const call = async (action, params) => {
        const res = await api.invoke(action, params);
        if (!res.ok) api.toast(res.error, 'error');
        return res;
      };

      function drawStatus() {
        const s = view.status;
        if (!s) return;
        toggle.textContent = s.monitoring ? 'Stop monitoring' : 'Start monitoring';
        toggle.className = `btn ${s.monitoring ? '' : 'btn-accent'}`;
        statusText.textContent = s.monitoring ? `Recording · ${fmtNumber(s.count)} entries` : `Paused · ${fmtNumber(s.count)} entries`;
        clear(notice);
        if (!s.appsDetected) notice.appendChild(statusNote('Tool Hub cannot tell which app is in front on this system, so the app exclusion list is not being applied. Copies marked private are still skipped.', 'warn'));
        if (!s.encrypted) notice.appendChild(statusNote('This system has no secure storage available, so the history is saved without encryption.', 'warn'));
        else if (!s.monitoring && !s.count) notice.appendChild(statusNote('Nothing is recorded until you start monitoring. Copies are only captured while Tool Hub is open. The history stays on this PC, encrypted.', 'info'));
      }

      function drawFilters() {
        clear(filters);
        for (const [id, label] of FILTERS) filters.appendChild(h('button', { class: `pdf-tab clip-tab${view.type === id ? ' active' : ''}`, type: 'button', text: label, onclick: () => { view.type = id; drawFilters(); refresh(); } }));
        const current = view.collection;
        clear(collectionSelect);
        collectionSelect.appendChild(h('option', { value: '', text: 'All collections' }));
        for (const item of view.status?.collections || []) collectionSelect.appendChild(h('option', { value: item.id, text: item.name, selected: item.id === current }));
      }

      function row(item) {
        const body = item.type === 'image'
          ? h('div', { class: 'clip-image' }, [h('img', { src: item.thumb, alt: 'Copied image' }), h('span', { class: 'muted', text: `${item.width} × ${item.height} · ${fmtBytes(item.size)}` })])
          : item.type === 'files'
            ? h('div', { class: 'clip-files' }, item.files.slice(0, 4).map(file => h('div', { class: 'mono ellipsis', text: file, title: file })).concat(item.files.length > 4 ? [h('div', { class: 'muted', text: `and ${item.files.length - 4} more` })] : []))
            : h('div', { class: 'clip-text', text: item.text.length > 400 ? `${item.text.slice(0, 400)}…` : item.text, title: item.text.slice(0, 2000) });
        const collections = view.status?.collections || [];
        const addTo = collections.length ? h('select', { class: 'input clip-add', title: 'Add to or remove from a collection', onchange: async e => {
          const id = e.target.value;
          if (id) { await call('setCollection', { id: item.id, collection: id, member: !item.collections.includes(id) }); refresh(true); }
        } }, [h('option', { value: '', text: 'Collection…' }), ...collections.map(entry => h('option', { value: entry.id, text: `${item.collections.includes(entry.id) ? '✓ ' : ''}${entry.name}` }))]) : null;
        return h('div', { class: `clip-row${item.pinned ? ' pinned' : ''}` }, [
          h('span', { class: 'tag clip-type', text: { text: 'Text', image: 'Image', files: `${item.files?.length || 0} file${item.files?.length === 1 ? '' : 's'}` }[item.type] }),
          h('div', { class: 'clip-main' }, [body, h('div', { class: 'muted clip-meta', text: [when(item.createdAt), item.app].filter(Boolean).join(' · ') })]),
          h('div', { class: 'clip-actions' }, [
            h('button', { class: 'mini-btn', type: 'button', text: 'Copy', onclick: async () => { if ((await call('copy', { id: item.id })).ok) api.toast('Copied to the clipboard', 'ok'); } }),
            h('button', { class: `mini-btn${item.pinned ? ' clip-on' : ''}`, type: 'button', text: item.pinned ? 'Pinned' : 'Pin', title: 'Pinned entries stay on top and are never removed automatically', onclick: async () => { await call('setFlags', { id: item.id, pinned: !item.pinned }); refresh(true); } }),
            h('button', { class: `mini-btn${item.favorite ? ' clip-on' : ''}`, type: 'button', text: item.favorite ? '★' : '☆', title: 'Favorite', onclick: async () => { await call('setFlags', { id: item.id, favorite: !item.favorite }); refresh(true); } }),
            addTo,
            h('button', { class: 'mini-btn mini-danger', type: 'button', text: '✕', title: 'Remove', onclick: async () => { await call('remove', { id: item.id }); refresh(true); } }),
          ]),
        ]);
      }

      async function refresh(force) {
        const status = await api.invoke('status', {});
        if (!status.ok) { clear(listEl); listEl.appendChild(statusNote(status.error, 'error')); return; }
        view.status = status.data;
        drawStatus();
        if (force === 'poll' && status.data.revision === view.revision) return;
        view.revision = status.data.revision;
        const res = await api.invoke('list', { query: view.query, type: view.type, collection: view.collection });
        if (!res.ok) return;
        clear(listEl);
        summary.textContent = `${fmtNumber(res.data.total)} ${res.data.total === 1 ? 'entry' : 'entries'}`;
        if (!res.data.items.length) listEl.appendChild(empty(view.query ? 'Nothing matches your search.' : 'Nothing here yet. Copy something while monitoring is on.'));
        for (const item of res.data.items) listEl.appendChild(row(item));
      }

      // ---------- settings ----------
      const retention = h('select', { class: 'input', onchange: e => save({ retentionDays: Number(e.target.value) }) });
      const maxItems = h('input', { class: 'input', type: 'number', min: '10', max: '10000', onchange: e => save({ maxItems: Number(e.target.value) }) });
      const exclusions = h('textarea', { class: 'input mono', rows: '4', spellcheck: 'false', placeholder: 'One app per line, for example keepass', onchange: e => save({ excludedApps: e.target.value.split('\n') }) });
      const newCollection = h('input', { class: 'input', type: 'text', placeholder: 'New collection name' });
      const collectionsEl = h('div', { class: 'clip-collections' });

      async function save(change) {
        const res = await call('setSettings', change);
        if (res.ok) { api.toast('Settings saved', 'ok'); refresh(true); }
      }

      function drawSettings() {
        const s = view.status?.settings;
        if (!s) return;
        clear(retention);
        for (const [value, label] of RETENTION) retention.appendChild(h('option', { value: String(value), text: label, selected: value === s.retentionDays }));
        maxItems.value = String(s.maxItems);
        exclusions.value = s.excludedApps.join('\n');
        clear(collectionsEl);
        for (const item of view.status.collections) collectionsEl.appendChild(h('span', { class: 'tag clip-collection' }, [item.name, h('button', { class: 'clip-x', type: 'button', text: '✕', title: `Delete ${item.name}. Its entries stay in the history.`, onclick: async () => { await call('removeCollection', { id: item.id }); if (view.collection === item.id) view.collection = ''; await refresh(true); drawFilters(); drawSettings(); } })]));
      }

      const addCollection = h('button', { class: 'btn btn-sm', type: 'button', text: 'Add collection', onclick: async () => {
        if ((await call('addCollection', { name: newCollection.value })).ok) { newCollection.value = ''; await refresh(true); drawFilters(); drawSettings(); }
      } });

      const settings = h('details', { class: 'group more-options-card' }, [
        h('summary', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Settings, collections and privacy' })]),
        h('div', { class: 'group-body' }, [
          h('div', { class: 'clip-settings' }, [
            h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Keep entries for' }), retention, h('span', { class: 'field-hint', text: 'Pinned, favorite and collected entries are always kept.' })]),
            h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Maximum entries' }), maxItems]),
          ]),
          h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Never record from these apps' }), exclusions, h('span', { class: 'field-hint', text: 'Matched against the name of the app in front when you copy. Password managers that mark their copies as private are also skipped automatically.' })]),
          h('div', { class: 'field' }, [h('span', { class: 'field-label', text: 'Collections' }), collectionsEl, h('div', { class: 'action-row' }, [newCollection, addCollection])]),
          h('div', { class: 'action-row' }, [
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Clear history', title: 'Keeps pinned, favorite and collected entries', onclick: async () => {
              if (!window.confirm('Clear the history? Pinned, favorite and collected entries are kept.')) return;
              await call('clear', {}); refresh(true);
            } }),
            h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Delete everything', onclick: async () => {
              if (!window.confirm('Delete every entry, including pinned ones? This cannot be undone.')) return;
              await call('clear', { everything: true }); refresh(true);
            } }),
          ]),
        ]),
      ]);

      root.append(
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Clipboard Manager' }), h('p', { class: 'tool-desc', text: 'A searchable history of the text, images and files you copy.' })]),
        h('div', { class: 'action-row' }, [toggle, statusText]),
        notice,
        h('div', { class: 'action-row clip-tools' }, [search, collectionSelect]),
        filters, summary, listEl, settings,
      );

      refresh(true).then(() => { drawFilters(); drawSettings(); });
      const poll = setInterval(() => {
        if (!root.isConnected) { clearInterval(poll); return; }
        refresh('poll');
      }, 1500);
      return root;
    },
  });
})();
