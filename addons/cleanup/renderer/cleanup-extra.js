(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('empty-folders', {
    render(api) {
      return toolShell({
        title: 'Empty Folder Cleaner', description: 'Find folders that are empty or contain only other empty folders. Selected folders go to the Recycle Bin.',
        action: 'scan', runLabel: 'Find empty folders', busyLabel: 'Scanning folders…',
        defaults: { root: '', recursive: true },
        fields: [{ type: 'folder', key: 'root', label: 'Folder to scan', wide: true }, { type: 'checkbox', key: 'recursive', label: 'Include subfolders' }],
        validate: state => state.root ? null : 'Choose a folder to scan',
        params: state => ({ root: state.root, recursive: state.recursive }),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Empty folders', fmtNumber(data.count)), stat('Folders checked', fmtNumber(data.scanned))]));
          if (!data.directories.length) { wrap.appendChild(empty('No empty folders found.')); return wrap; }
          const selected = new Set(data.directories.map(item => item.path));
          const count = h('span', { class: 'picker-count', text: `${selected.size} selected` });
          const remove = h('button', { class: 'btn btn-danger', type: 'button', text: 'Move selected to Recycle Bin', onclick: async () => {
            if (!selected.size || !window.confirm(`Move ${selected.size} empty folder(s) to the Recycle Bin?`)) return;
            remove.disabled = true;
            const res = await api.invoke('remove', { root: ctx.state.root, paths: [...selected] });
            remove.disabled = false;
            if (!res.ok) { api.toast(res.error, 'error'); return; }
            api.toast(`Moved ${res.data.removed} folder(s) to the Recycle Bin${res.data.failed.length ? `; ${res.data.failed.length} skipped` : ''}`, res.data.failed.length ? 'warn' : 'ok');
            ctx.rerun();
          } });
          const rows = data.directories.map(item => h('div', { class: 'tbl-row' }, [
            h('input', { type: 'checkbox', checked: true, onchange: e => { e.target.checked ? selected.add(item.path) : selected.delete(item.path); count.textContent = `${selected.size} selected`; } }),
            h('span', { class: 'mono ellipsis', text: item.name, title: item.path }),
            h('span', { class: 'muted ellipsis', text: item.path, title: item.path }),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(item.path) }),
          ]));
          wrap.appendChild(h('div', { class: 'action-row' }, [remove, count]));
          wrap.appendChild(table([{ label: '', width: '32px' }, { label: 'Folder', width: 'minmax(0,1fr)' }, { label: 'Path', width: 'minmax(0,2fr)' }, { label: '', width: '72px' }], rows));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('small-files', {
    render(api) {
      return toolShell({
        title: 'Zero-Byte & Shortcut Finder', description: 'Find empty files and broken Windows shortcuts. Files you remove go to the Recycle Bin.',
        action: 'scan', runLabel: 'Find empty files', busyLabel: 'Scanning files…', defaults: { root: '', recursive: true },
        fields: [{ type: 'folder', key: 'root', label: 'Folder to scan', wide: true }, { type: 'checkbox', key: 'recursive', label: 'Include subfolders' }],
        validate: state => state.root ? null : 'Choose a folder to scan', params: state => ({ root: state.root, recursive: state.recursive }),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Findings', fmtNumber(data.count)), stat('Empty files', fmtNumber(data.findings.filter(item => item.kind === 'Zero-byte file').length))]));
          if (!data.shortcutsSupported) wrap.appendChild(statusNote('Broken shortcut checks are available on Windows.', 'info'));
          if (data.truncated) wrap.appendChild(statusNote('Scan reached the file limit; results are partial.', 'warn'));
          if (!data.findings.length) { wrap.appendChild(empty('No zero-byte files or broken shortcuts found.')); return wrap; }
          const selected = new Set(data.findings.map(item => item.path));
          const rows = data.findings.map(item => h('div', { class: 'tbl-row' }, [
            h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? selected.add(item.path) : selected.delete(item.path) }),
            h('span', { class: 'mono ellipsis', text: item.name, title: item.path }),
            h('span', { class: 'tag tag-warn', text: item.kind }),
            h('span', { class: 'mono', text: fmtBytes(item.size) }),
            h('span', { class: 'muted ellipsis', text: item.dir, title: item.dir }),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(item.path) }),
          ]));
          const remove = h('button', { class: 'btn btn-danger', type: 'button', text: 'Move selected to Recycle Bin', onclick: async () => {
            if (!selected.size || !window.confirm(`Move ${selected.size} file(s) to the Recycle Bin?`)) return;
            const res = await api.invoke('remove', { root: ctx.state.root, paths: [...selected] });
            if (!res.ok) { api.toast(res.error, 'error'); return; }
            api.toast(`Moved ${res.data.removed} file(s) to the Recycle Bin`, 'ok');
            ctx.rerun();
          } });
          wrap.appendChild(h('div', { class: 'action-row' }, [remove]));
          wrap.appendChild(table([{ label: '', width: '32px' }, { label: 'Name', width: 'minmax(0,1.5fr)' }, { label: 'Finding', width: '150px' }, { label: 'Size', width: '90px' }, { label: 'Folder', width: 'minmax(0,1.5fr)' }, { label: '', width: '72px' }], rows));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('secure-delete', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    let files = [];
    const dryRun = h('input', { type: 'checkbox', checked: true, onchange: e => { shred.textContent = e.target.checked ? 'Preview secure delete' : 'Overwrite and delete'; } });
    const choose = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose files…', onclick: async () => { files = await api.pickFiles() || []; results.textContent = `${files.length} file(s) selected`; } });
    const shred = h('button', { class: 'btn btn-danger', type: 'button', text: 'Preview secure delete', onclick: async () => {
      if (dryRun.checked) { api.toast(`Preview: ${files.length} file(s), ${fmtBytes(files.reduce((sum, file) => sum + file.size, 0))}. No files changed.`, 'info'); return; }
      if (!files.length || !window.confirm(`Overwrite and permanently delete ${files.length} file(s)? This cannot be undone.`)) return;
      if (!window.confirm('Overwriting is not reliable on SSDs, flash storage, copy-on-write filesystems, or cloud-synced drives. Continue?')) return;
      shred.disabled = true; const result = await api.invoke('shred', { paths: files.map(f => f.path) }); shred.disabled = false;
      if (!result.ok) api.toast(result.error, 'error'); else api.toast(`Deleted ${result.data.deleted}; ${result.data.failed.length} failed`, result.data.failed.length ? 'warn' : 'ok');
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Secure Delete' }), h('p', { class: 'tool-desc', text: 'Overwrites selected file contents and permanently deletes them. This cannot guarantee recovery is impossible, especially on SSDs.' })]));
    root.appendChild(h('div', { class: 'action-row' }, [choose, h('label', { class: 'field field-inline' }, [dryRun, h('span', { text: 'Preview only' })]), shred])); root.appendChild(results); return root;
  } });

  Hub.registerView('scheduled-cleanup', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    const selected = new Set(); let scanData = null;
    const day = h('select', { class: 'input' }, [['SUN','Sunday'],['MON','Monday'],['TUE','Tuesday'],['WED','Wednesday'],['THU','Thursday'],['FRI','Friday'],['SAT','Saturday']].map(([value,label]) => h('option', { value, text: label })));
    const time = h('input', { class: 'input', type: 'time', value: '03:00' });
    const remove = h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Remove schedule', onclick: async () => { const result = await api.invoke('remove', {}); if (!result.ok) api.toast(result.error, 'error'); else api.toast('Weekly cleanup schedule removed', 'ok'); refreshStatus(); } });
    const refreshStatus = async () => { const status = await api.invoke('status', {}); const label = document.getElementById('scheduled-cleanup-status'); if (label) label.textContent = status.ok && status.data.installed ? `Scheduled task found.\n${status.data.details}` : 'No weekly cleanup task is installed.'; };
    const drawTargets = data => {
      scanData = data; clear(results);
      results.appendChild(h('div', { class: 'stat-row' }, [stat('Available targets', fmtNumber(data.targets.filter(x => x.available).length))]));
      results.appendChild(table([{ label: '', width: '32px' }, { label: 'Location', width: 'minmax(0,1fr)' }, { label: 'Size', width: '110px' }], data.targets.map(target => h('div', { class: 'tbl-row' }, [h('input', { type: 'checkbox', disabled: !target.available, onchange: e => e.target.checked ? selected.add(target.id) : selected.delete(target.id) }), h('span', { class: 'ellipsis', text: target.label, title: target.path }), h('span', { class: 'mono', text: target.available ? fmtBytes(target.size) : 'n/a' })]))));
    };
    const create = h('button', { class: 'btn btn-accent', type: 'button', text: 'Schedule weekly cleanup', onclick: async () => {
      if (!selected.size) { api.toast('Select at least one location', 'error'); return; }
      if (!window.confirm(`Create a weekly cleanup for ${selected.size} location(s)? Files are sent to the Recycle Bin.`)) return;
      create.disabled = true; const result = await api.invoke('create', { ids: [...selected], day: day.value, time: time.value }); create.disabled = false;
      if (!result.ok) api.toast(result.error, 'error'); else { api.toast(`Scheduled for ${result.data.day} at ${result.data.time}`, 'ok'); refreshStatus(); }
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Scheduled Cleanup' }), h('p', { class: 'tool-desc', text: 'Create a Windows weekly task to send selected temporary and browser-cache files to the Recycle Bin.' })]));
    const status = h('pre', { class: 'status-note', id: 'scheduled-cleanup-status', text: 'Checking scheduled task…' }); root.appendChild(status);
    root.appendChild(h('div', { class: 'action-row' }, [day, time, create, remove])); root.appendChild(results);
    api.invoke('targets', {}).then(result => { if (result.ok) drawTargets(result.data); else results.appendChild(statusNote(result.error, 'error')); }); refreshStatus(); return root;
  } });
})();
