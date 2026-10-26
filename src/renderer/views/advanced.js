(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('folder-sync', { render(api) {
    return toolShell({
      title: 'Folder Sync', description: 'Preview files missing from the mirror or newer in the source, then copy them.', action: 'syncPlan', runLabel: 'Preview sync', busyLabel: 'Comparing folders…',
      defaults: { source: '', destination: '' }, fields: [{ type: 'folder', key: 'source', label: 'Source folder' }, { type: 'folder', key: 'destination', label: 'Mirror folder' }],
      validate: s => s.source && s.destination ? null : 'Choose both folders', params: s => ({ source: s.source, destination: s.destination }),
      render(data) {
        const wrap = h('div');
        wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Files to copy', fmtNumber(data.count)), stat('Total size', fmtBytes(data.totalBytes))]));
        if (data.truncated) wrap.appendChild(statusNote('One folder reached the scan limit. Preview may be partial.', 'warn'));
        if (data.omitted) wrap.appendChild(statusNote(`Showing the first 1,000 of ${fmtNumber(data.totalCandidates)} copy candidates. Run the sync again to preview the next changes after this batch.`, 'warn'));
        const apply = h('button', { class: 'btn btn-accent', type: 'button', text: 'Copy previewed files', onclick: async () => {
          if (!data.count || !window.confirm(`Copy ${data.count} file(s) into the mirror? Existing files are replaced only when the source is newer.`)) return;
          apply.disabled = true;
          const result = await api.invoke('syncApply', { source: data.source, destination: data.destination, items: data.copies });
          apply.disabled = false;
          if (!result.ok) { api.toast(result.error, 'error'); return; }
          api.toast(`Copied ${result.data.copied} file(s); ${result.data.failed.length} failed`, result.data.failed.length ? 'warn' : 'ok');
        } });
        wrap.appendChild(h('div', { class: 'action-row' }, [apply]));
        if (!data.copies.length) wrap.appendChild(empty('The mirror is up to date.'));
        else wrap.appendChild(table([{ label: 'File', width: 'minmax(0,1fr)' }, { label: 'Action', width: '100px' }, { label: 'Size', width: '100px' }], data.copies.map(item => h('div', { class: 'tbl-row' }, [h('span', { class: 'mono ellipsis', text: item.relative }), h('span', { class: 'tag', text: item.reason }), h('span', { class: 'mono', text: fmtBytes(item.size) })]))));
        return wrap;
      },
    }, api);
  } });

  Hub.registerView('file-type', { render(api) {
    return toolShell({
      title: 'File Type Fixer', description: 'Compare file headers with extensions. Supported signatures: PNG, JPEG, GIF, PDF, ZIP and MP3.', action: 'fileTypeScan', runLabel: 'Scan folder', busyLabel: 'Checking file headers…',
      defaults: { root: '', recursive: true }, fields: [{ type: 'folder', key: 'root', label: 'Folder to scan', wide: true }, { type: 'checkbox', key: 'recursive', label: 'Include subfolders' }], validate: s => s.root ? null : 'Choose a folder', params: s => ({ root: s.root, recursive: s.recursive }),
      render(data, ctx) {
        const wrap = h('div');
        wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Mismatches', fmtNumber(data.count))]));
        if (data.truncated) wrap.appendChild(statusNote('The scan limit was reached.', 'warn'));
        if (!data.findings.length) { wrap.appendChild(empty('No supported extension mismatches found.')); return wrap; }
        const selected = new Set(data.findings.map(item => item.path));
        const action = h('button', { class: 'btn btn-accent', type: 'button', text: 'Rename selected extensions', onclick: async () => {
          const items = data.findings.filter(item => selected.has(item.path));
          if (!items.length || !window.confirm(`Rename ${items.length} file extension(s) based on their detected signatures?`)) return;
          action.disabled = true;
          const result = await api.invoke('fixExtensions', { root: ctx.state.root, items });
          action.disabled = false;
          if (!result.ok) { api.toast(result.error, 'error'); return; }
          api.toast(`Corrected ${result.data.renamed} extension(s); ${result.data.failed.length} failed`, result.data.failed.length ? 'warn' : 'ok');
          ctx.rerun();
        } });
        wrap.appendChild(h('div', { class: 'action-row' }, [action]));
        wrap.appendChild(table([{ label: '', width: '32px' }, { label: 'File', width: 'minmax(0,1fr)' }, { label: 'Current', width: '100px' }, { label: 'Detected', width: '100px' }, { label: 'Size', width: '100px' }], data.findings.map(item => h('div', { class: 'tbl-row' }, [h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? selected.add(item.path) : selected.delete(item.path) }), h('span', { class: 'mono ellipsis', text: item.name, title: item.path }), h('span', { class: 'tag tag-warn', text: item.extension }), h('span', { class: 'tag tag-ok', text: item.detected }), h('span', { class: 'mono', text: fmtBytes(item.size) })]))));
        return wrap;
      },
    }, api);
  } });

  Hub.registerView('archive-tool', { render(api) {
    const root = h('div', { class: 'tool' });
    let mode = 'create', source = '', outputDir = '', archive = '', destination = '';
    const status = h('div');
    const fields = h('div', { class: 'group-body' });
    const draw = () => {
      clear(fields);
      const choose = (label, key) => h('button', { class: 'btn btn-sm', type: 'button', text: `${label}: ${({ source, outputDir, archive, destination })[key] || 'Choose…'}`, onclick: async () => {
        if (key === 'archive') { const files = await api.pickFiles(); if (files?.[0]) archive = files[0].path; }
        else { const folder = await api.pickFolder(label); if (folder) ({ source, outputDir, destination }[key] = folder); }
        draw();
      } });
      const name = h('input', { class: 'input', type: 'text', value: 'archive.zip', placeholder: 'archive.zip' });
      fields.appendChild(h('div', { class: 'field-row' }, [h('button', { class: `settings-mode-btn${mode === 'create' ? ' active' : ''}`, text: 'Create ZIP', onclick: () => { mode = 'create'; draw(); } }), h('button', { class: `settings-mode-btn${mode === 'extract' ? ' active' : ''}`, text: 'Extract ZIP', onclick: () => { mode = 'extract'; draw(); } })]));
      if (mode === 'create') fields.appendChild(h('div', { class: 'field-row' }, [choose('Source folder', 'source'), choose('Save in folder', 'outputDir'), name]));
      else fields.appendChild(h('div', { class: 'field-row' }, [choose('ZIP file', 'archive'), choose('Extract into', 'destination')]));
      fields.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-accent', type: 'button', text: mode === 'create' ? 'Create archive' : 'Extract archive', onclick: async e => {
        if (mode === 'create' ? (!source || !outputDir) : (!archive || !destination)) { api.toast('Choose the required paths first', 'error'); return; }
        if (mode === 'create' && !/^[^\\/:*?"<>|]+\.zip$/i.test(name.value)) { api.toast('Enter a valid .zip filename', 'error'); return; }
        if (!window.confirm(mode === 'create' ? `Create ${name.value} from this folder?` : 'Extract the selected archive here? Existing files may be overwritten.')) return;
        e.currentTarget.disabled = true; e.currentTarget.textContent = mode === 'create' ? 'Creating…' : 'Extracting…';
        const result = await api.invoke('archive', mode === 'create' ? { operation: 'create', root: source, outputDir, name: name.value } : { operation: 'extract', archive, destination });
        e.currentTarget.disabled = false; e.currentTarget.textContent = mode === 'create' ? 'Create archive' : 'Extract archive';
        if (!result.ok) api.toast(result.error, 'error'); else api.toast(mode === 'create' ? `Archive created: ${result.data.output}` : `Extracted to ${result.data.destination}`, 'ok');
      } })]));
    };
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Archive Tool' }), h('p', { class: 'tool-desc', text: 'Create and extract ZIP archives. Large archives may take a while.' })]));
    root.appendChild(h('div', { class: 'group' }, [fields])); root.appendChild(status); draw(); return root;
  } });

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

  Hub.registerView('watch-folder', { render(api) {
    const root = h('div', { class: 'tool' }), status = h('div', { class: 'results' });
    const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
    const state = { folder: '', timer: null, busy: false, moved: 0, rules: [] };
    const stop = () => { if (state.timer) clearInterval(state.timer); state.timer = null; state.busy = false; };
    const start = h('button', { class: 'btn btn-accent', type: 'button', text: 'Start watching', onclick: async () => {
      if (state.timer) { stop(); start.textContent = 'Start watching'; status.textContent = 'Watcher stopped.'; return; }
      if (!state.folder) { api.toast('Choose a folder first', 'error'); return; }
      try { state.rules = JSON.parse(localStorage.getItem('toolhub_org_rules_v1') || '[]').filter(rule => rule.dest); } catch { state.rules = []; }
      if (!state.rules.length) { api.toast('Save at least one Organizer rule with a destination first', 'error'); return; }
      const run = async () => {
        if (!root.isConnected) { stop(); return; }
        if (state.busy) return; state.busy = true;
        try {
          const scan = await api.invoke('readFolder', { folder: state.folder, recursive: true });
          if (scan.ok) for (const file of scan.data.files) {
            const rule = state.rules.find(r => {
              if (r.type === 'date' || r.type === 'exifDate') {
                const year = r.type === 'exifDate' ? Number(file.tags?.DateTaken?.slice(0, 4)) : new Date(file.mtime).getFullYear();
                return Number.isFinite(year) && (!!r.dateFrom || !!r.dateTo) && (!r.dateFrom || year >= Number(r.dateFrom)) && (!r.dateTo || year <= Number(r.dateTo));
              }
              if (r.type === 'size') return (!!r.sizeMin || !!r.sizeMax) && (!r.sizeMin || file.size >= Number(r.sizeMin) * ({ KB: 1024, MB: 1048576, GB: 1073741824 }[r.sizeMinUnit] || 1048576)) && (!r.sizeMax || file.size <= Number(r.sizeMax) * ({ KB: 1024, MB: 1048576, GB: 1073741824 }[r.sizeMaxUnit] || 1048576));
              const pattern = String(r.match || '').trim();
              if (!pattern) return false;
              const glob = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
              return new RegExp(pattern.includes('*') || pattern.includes('?') ? `^${glob}$` : glob, 'i').test(file.name);
            });
            if (!rule) continue;
            const destination = String(rule.dest).replace(/\{year\}/gi, file.tags?.DateTaken?.slice(0, 4) || new Date(file.mtime).getFullYear()).replace(/\{month\}/gi, file.tags?.DateTaken?.slice(5, 7) || String(new Date(file.mtime).getMonth() + 1).padStart(2, '0'));
            const moved = await api.invoke('move', { folder: state.folder, relativePath: file.relativePath, fileName: file.name, destFolder: destination });
            if (moved.ok) state.moved++;
          }
          status.textContent = `Watching ${state.folder} · moved ${state.moved} file(s) · checks every 5 seconds`;
        } finally { state.busy = false; }
      };
      start.textContent = 'Stop watching'; await run(); state.timer = setInterval(run, 5000);
    } });
    const pick = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose folder', onclick: async () => { const folder = await api.pickFolder('Folder to watch'); if (folder) { state.folder = folder; folderLabel.textContent = folder; folderLabel.classList.remove('empty'); } } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Watch Folder' }), h('p', { class: 'tool-desc', text: 'Automatically apply saved Organizer filename-pattern rules while this screen is open.' })]));
    root.appendChild(h('div', { class: 'action-row' }, [pick, folderLabel, start])); root.appendChild(status);
    return root;
  } });

  Hub.registerView('file-locks', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    const chosen = h('span', { class: 'muted', text: 'No file selected' }); let filePath = '';
    const pick = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose file…', onclick: async () => { const files = await api.pickFiles(); if (files?.[0]) { filePath = files[0].path; chosen.textContent = files[0].path; } } });
    const check = h('button', { class: 'btn btn-accent', type: 'button', text: 'Check for locks', onclick: async () => {
      if (!filePath) { api.toast('Choose a file first', 'error'); return; }
      check.disabled = true; const result = await api.invoke('locking', { path: filePath }); check.disabled = false; clear(results);
      if (!result.ok) { results.appendChild(statusNote(result.error, 'error')); return; }
      const items = Array.isArray(result.data.processes) ? result.data.processes : (result.data.processes ? [result.data.processes] : []);
      if (!items.length) results.appendChild(empty('No locking process was found.'));
      else results.appendChild(table([{ label: 'Process', width: 'minmax(0,1fr)' }, { label: 'PID', width: '100px' }], items.map(item => h('div', { class: 'tbl-row' }, [h('span', { text: item.Process || item.process || 'Unknown' }), h('span', { class: 'mono', text: String(item.Pid || item.pid) })]))));
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'File Lock Finder' }), h('p', { class: 'tool-desc', text: 'Ask Windows Restart Manager which processes are using a file. This does not close them.' })]));
    root.appendChild(h('div', { class: 'action-row' }, [pick, chosen, check])); root.appendChild(results); return root;
  } });

  Hub.registerView('disk-benchmark', { render(api) {
    return toolShell({
      title: 'Disk Benchmark', description: 'Write and read a temporary test file, then remove it. Results are sequential speed estimates and can vary with cache, encryption, and background load.',
      action: 'run', runLabel: 'Start benchmark', busyLabel: 'Benchmarking…', defaults: { root: '', sizeMiB: 128 },
      fields: [{ type: 'folder', key: 'root', label: 'Drive folder to test', wide: true }, { type: 'select', key: 'sizeMiB', label: 'Test file size', numeric: true, options: [64, 128, 256, 512].map(size => ({ label: `${size} MiB`, value: size })) }],
      validate: state => state.root ? null : 'Choose a folder on the drive to test', params: state => ({ root: state.root, sizeMiB: state.sizeMiB }),
      render(data) { return h('div', { class: 'stat-row' }, [stat('Sequential write', `${data.writeMiBs} MiB/s`), stat('Sequential read', `${data.readMiBs} MiB/s`), stat('Test size', `${data.sizeMiB} MiB`)]); },
    }, api);
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

  Hub.registerView('pdf-tools', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    let paths = [], outputDir = '', path = '';
    const nameMerge = h('input', { class: 'input', type: 'text', value: 'merged.pdf' });
    const nameSplit = h('input', { class: 'input', type: 'text', value: 'pages.pdf' });
    const start = h('input', { class: 'input', type: 'number', min: '1', value: '1', placeholder: 'First page' });
    const end = h('input', { class: 'input', type: 'number', min: '1', value: '1', placeholder: 'Last page' });
    const chooseMany = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose PDFs…', onclick: async () => { const chosen = await api.pickFiles(); paths = (chosen || []).filter(file => file.path.toLowerCase().endsWith('.pdf')).map(file => file.path); results.textContent = `${paths.length} PDF(s) selected`; } });
    const chooseOne = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose PDF…', onclick: async () => { const chosen = await api.pickFiles(); path = chosen?.find(file => file.path.toLowerCase().endsWith('.pdf'))?.path || ''; results.textContent = path || 'No PDF selected'; } });
    const chooseOut = () => h('button', { class: 'btn btn-sm', type: 'button', text: 'Save in folder…', onclick: async () => { outputDir = await api.pickFolder('Choose output folder') || outputDir; if (outputDir) results.textContent = `Output folder: ${outputDir}`; } });
    const doMerge = h('button', { class: 'btn btn-accent', type: 'button', text: 'Merge PDFs', onclick: async () => {
      if (paths.length < 2 || !outputDir) { api.toast('Choose at least two PDFs and an output folder', 'error'); return; }
      if (!window.confirm(`Merge ${paths.length} PDFs into ${nameMerge.value}?`)) return;
      doMerge.disabled = true; const result = await api.invoke('merge', { paths, outputDir, name: nameMerge.value }); doMerge.disabled = false;
      if (!result.ok) api.toast(result.error, 'error'); else api.toast(`Merged ${result.data.pages} pages to ${result.data.output}`, 'ok');
    } });
    const doSplit = h('button', { class: 'btn btn-accent', type: 'button', text: 'Extract page range', onclick: async () => {
      if (!path || !outputDir) { api.toast('Choose a PDF and output folder', 'error'); return; }
      doSplit.disabled = true; const result = await api.invoke('split', { path, outputDir, name: nameSplit.value, start: start.value, end: end.value }); doSplit.disabled = false;
      if (!result.ok) api.toast(result.error, 'error'); else api.toast(`Saved ${result.data.pages} page(s) to ${result.data.output}`, 'ok');
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'PDF Merge & Split' }), h('p', { class: 'tool-desc', text: 'Merge selected PDFs or extract a page range to a new PDF. Files are processed locally.' })]));
    root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Merge PDFs' })]), h('div', { class: 'group-body' }, [h('div', { class: 'action-row' }, [chooseMany, chooseOut(), nameMerge, doMerge])])])) ;
    root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Split PDF by page range' })]), h('div', { class: 'group-body' }, [h('div', { class: 'action-row' }, [chooseOne, chooseOut(), start, end, nameSplit, doSplit])])])) ;
    root.appendChild(results); return root;
  } });

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
          if (!dryRun.checked) { const saved = await api.invoke('write', { dir: folder, name: file.name, dataUrl, overwrite: true }); if (!saved.ok) throw new Error(saved.error); }
          done++;
        } catch { failed++; }
      }
      process.disabled = false; api.toast(`${dryRun.checked ? 'Previewed' : 'Processed'} ${done}; ${failed} failed${dryRun.checked ? ' · nothing saved' : ''}`, failed ? 'warn' : 'ok');
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Image Privacy & Watermark' }), h('p', { class: 'tool-desc', text: 'Re-encoding JPEG, PNG and WebP removes embedded metadata. Watermarking edits originals in place; keep a copy if needed.' })]));
    root.appendChild(h('div', { class: 'field-row' }, [choose, mode, watermark, h('label', { class: 'field field-inline' }, [dryRun, h('span', { text: 'Preview only' })]), process])); root.appendChild(results); return root;
  } });

  Hub.registerView('workflows', { render(api) {
    const KEY = 'toolhub_workflows_v1';
    const readWorkflows = () => { try { const value = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(value) ? value.slice(0, 30) : []; } catch { return []; } };
    let workflows = readWorkflows(), selected = null;
    const root = h('div', { class: 'tool' }), status = h('div', { class: 'results' });
    const wfName = h('input', { class: 'input', type: 'text', placeholder: 'Pipeline name' });
    const folderLabel = h('span', { class: 'path-display empty', text: 'No source folder selected' }); let folder = '';
    const template = h('input', { class: 'input mono', type: 'text', value: '{original}', placeholder: '{n} - {original}' });
    const archiveName = h('input', { class: 'input', type: 'text', value: 'archive.zip' });
    const archiveFolderLabel = h('span', { class: 'path-display empty', text: 'No archive folder selected' }); let archiveFolder = '';
    const doRename = h('input', { type: 'checkbox' }), doOrganize = h('input', { type: 'checkbox' }), doArchive = h('input', { type: 'checkbox' }), dryRun = h('input', { type: 'checkbox', checked: true });
    const workflowSelect = h('select', { class: 'input', onchange: () => loadSelected() });
    const drawWorkflows = () => { clear(workflowSelect); workflowSelect.appendChild(h('option', { value: '', text: 'Choose saved workflow…' })); workflows.forEach((wf, i) => workflowSelect.appendChild(h('option', { value: String(i), text: wf.name }))); };
    const loadSelected = () => { const wf = workflows[Number(workflowSelect.value)]; selected = wf || null; if (!wf) return; wfName.value = wf.name; template.value = wf.template; doRename.checked = wf.rename; doOrganize.checked = wf.organize; doArchive.checked = wf.archive; archiveName.value = wf.archiveName || 'archive.zip'; };
    const save = h('button', { class: 'btn btn-sm', type: 'button', text: 'Save workflow', onclick: () => {
      const name = wfName.value.trim(); if (!name) { api.toast('Enter a workflow name', 'error'); return; }
      const workflow = { id: selected?.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`, name, rename: doRename.checked, template: template.value || '{original}', organize: doOrganize.checked, archive: doArchive.checked, archiveName: archiveName.value || 'archive.zip' };
      workflows = [workflow, ...workflows.filter(item => item.id !== workflow.id)].slice(0, 30); localStorage.setItem(KEY, JSON.stringify(workflows)); selected = workflow; drawWorkflows(); workflowSelect.value = '0'; api.toast('Workflow saved', 'ok');
    } });
    const pickFolder = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose source folder', onclick: async () => { const result = await api.pickFolder('Workflow source folder'); if (result) { folder = result; folderLabel.textContent = result; folderLabel.classList.remove('empty'); } } });
    const pickArchiveFolder = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose archive folder', onclick: async () => { const result = await api.pickFolder('Archive output folder'); if (result) { archiveFolder = result; archiveFolderLabel.textContent = result; archiveFolderLabel.classList.remove('empty'); } } });
    const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Run workflow', onclick: async () => {
      const workflow = selected || { rename: doRename.checked, template: template.value, organize: doOrganize.checked, archive: doArchive.checked, archiveName: archiveName.value, name: wfName.value || 'Workflow' };
      if (!folder) { api.toast('Choose a source folder', 'error'); return; }
      if (!workflow.rename && !workflow.organize && !workflow.archive) { api.toast('Select at least one workflow step', 'error'); return; }
      if (workflow.archive && (!archiveFolder || !/^[^\\/:*?"<>|]+\.zip$/i.test(workflow.archiveName))) { api.toast('Choose an archive folder and a valid .zip name', 'error'); return; }
      const preview = dryRun.checked;
      if (!preview && !window.confirm(`Run workflow “${workflow.name}” on this folder?`)) return;
      clear(status); run.disabled = true; let current = folder; const log = [];
      try {
        if (workflow.rename) {
          const scan = await api.invokeTool('renamer', 'readFolder', { folder: current, recursive: true }); if (!scan.ok) throw new Error(scan.error);
          const items = scan.data.files.map((file, i) => {
            const { base, ext } = splitName(file.name); let name = String(workflow.template || '{original}').replace(/\{original\}/gi, base).replace(/\{ext\}/gi, ext).replace(/\{n\}/gi, String(i + 1).padStart(2, '0'));
            if (ext && !name.toLowerCase().endsWith(`.${ext}`)) name += `.${ext}`;
            name = name.replace(/[\\/:*?"<>|]/g, '_'); return { oldName: file.name, newName: name, relativePath: file.relativePath };
          }).filter(item => item.oldName !== item.newName);
          if (preview) log.push(`Would rename ${items.length} file(s) with template “${workflow.template}”.`);
          else if (items.length) { const changed = await api.invokeTool('renamer', 'renameBatch', { folder: current, items }); if (!changed.ok) throw new Error(changed.error); log.push(`Renamed ${changed.data.renamed} file(s).`); }
        }
        if (workflow.organize) {
          let rules = []; try { rules = JSON.parse(localStorage.getItem('toolhub_org_rules_v1') || '[]').filter(rule => rule.dest); } catch {}
          if (!rules.length) throw new Error('Save Organizer rules before running the organize step.');
          const scan = await api.invokeTool('organizer', 'readFolder', { folder: current, recursive: true }); if (!scan.ok) throw new Error(scan.error);
          let count = 0;
          for (const file of scan.data.files) {
            const rule = rules.find(item => workflowRuleMatches(item, file)); if (!rule) continue;
            const dest = String(rule.dest).replace(/\{year\}/gi, file.tags?.DateTaken?.slice(0, 4) || new Date(file.mtime).getFullYear()).replace(/\{month\}/gi, file.tags?.DateTaken?.slice(5, 7) || String(new Date(file.mtime).getMonth() + 1).padStart(2, '0'));
            if (preview) { count++; continue; }
            const moved = await api.invokeTool('organizer', 'move', { folder: current, relativePath: file.relativePath, fileName: file.name, destFolder: dest }); if (!moved.ok) throw new Error(`${file.name}: ${moved.error}`); count++;
          }
          log.push(preview ? `Would organize ${count} file(s) using saved rules.` : `Organized ${count} file(s).`);
        }
        if (workflow.archive) {
          if (preview) log.push(`Would create ${workflow.archiveName} from the processed folder.`);
          else { const zipped = await api.invokeTool('archive-tool', 'archive', { operation: 'create', root: current, outputDir: archiveFolder, name: workflow.archiveName }); if (!zipped.ok) throw new Error(zipped.error); log.push(`Created ${zipped.data.output}.`); }
        }
        status.appendChild(statusNote(`${preview ? 'Preview only — no changes were made. ' : ''}${log.join(' ')}`, preview ? 'info' : 'ok'));
        const history = JSON.parse(localStorage.getItem('toolhub_workflow_history_v1') || '[]'); history.unshift({ name: workflow.name, at: Date.now(), preview, log }); localStorage.setItem('toolhub_workflow_history_v1', JSON.stringify(history.slice(0, 50)));
      } catch (err) { status.appendChild(statusNote(err.message, 'error')); }
      finally { run.disabled = false; }
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Workflows' }), h('p', { class: 'tool-desc', text: 'Save a sequence of rename, organize and ZIP steps. Runs start in preview mode.' })]));
    root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Saved pipelines' })]), h('div', { class: 'group-body' }, [workflowSelect, wfName]) ]));
    root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Steps' })]), h('div', { class: 'group-body' }, [h('label', { class: 'field field-inline' }, [doRename, h('span', { text: 'Rename using template' })]), template, h('label', { class: 'field field-inline' }, [doOrganize, h('span', { text: 'Organize using saved Organizer rules' })]), h('label', { class: 'field field-inline' }, [doArchive, h('span', { text: 'Compress to ZIP' })]), archiveName, pickArchiveFolder, archiveFolderLabel]) ]));
    root.appendChild(h('div', { class: 'action-row' }, [pickFolder, folderLabel, h('label', { class: 'field field-inline' }, [dryRun, h('span', { text: 'Preview only' })]), save, run])); root.appendChild(status); drawWorkflows(); return root;
  } });

  function splitName(name) { const dot = name.lastIndexOf('.'); return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot + 1) } : { base: name, ext: '' }; }
  function workflowRuleMatches(rule, file) {
    if (rule.type === 'exifDate') { const year = Number(file.tags?.DateTaken?.slice(0, 4)); return Number.isFinite(year) && (!rule.dateFrom || year >= Number(rule.dateFrom)) && (!rule.dateTo || year <= Number(rule.dateTo)); }
    if (rule.type === 'date') { const year = new Date(file.mtime).getFullYear(); return (!!rule.dateFrom || !!rule.dateTo) && (!rule.dateFrom || year >= Number(rule.dateFrom)) && (!rule.dateTo || year <= Number(rule.dateTo)); }
    if (rule.type === 'size') { const unit = value => ({ KB: 1024, MB: 1048576, GB: 1073741824 }[value] || 1048576); return (!!rule.sizeMin || !!rule.sizeMax) && (!rule.sizeMin || file.size >= Number(rule.sizeMin) * unit(rule.sizeMinUnit)) && (!rule.sizeMax || file.size <= Number(rule.sizeMax) * unit(rule.sizeMaxUnit)); }
    const pattern = String(rule.match || '').trim(); if (!pattern) return false;
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(pattern.includes('*') || pattern.includes('?') ? `^${escaped}$` : escaped, 'i').test(file.name);
  }

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
