(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('tree-export', {
    render(api) {
      return toolShell({
        title: 'Directory Tree Export', description: 'Create a readable folder structure and save it as text or Markdown.',
        action: 'export', runLabel: 'Build directory tree', busyLabel: 'Reading folders…',
        defaults: { root: '', format: 'markdown', maxDepth: 20, includeFiles: true },
        fields: [
          { type: 'folder', key: 'root', label: 'Folder to export', wide: true },
          { type: 'select', key: 'format', label: 'Format', options: [{ label: 'Markdown', value: 'markdown' }, { label: 'Plain text', value: 'text' }] },
          { type: 'select', key: 'maxDepth', label: 'Maximum depth', numeric: true, options: [5, 10, 20, 50].map(n => ({ label: String(n), value: n })) },
          { type: 'checkbox', key: 'includeFiles', label: 'Include files' },
        ],
        validate: state => state.root ? null : 'Choose a folder to export',
        params: state => ({ root: state.root, format: state.format, maxDepth: state.maxDepth, includeFiles: state.includeFiles }),
        render(data) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Entries', fmtNumber(data.count))]));
          if (data.truncated) wrap.appendChild(statusNote('Output was capped at 20,000 entries.', 'warn'));
          wrap.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-accent', type: 'button', text: 'Download tree', onclick: () => downloadFile(`${data.format === 'markdown' ? 'directory-tree.md' : 'directory-tree.txt'}`, data.text, 'text/plain;charset=utf-8') })]));
          wrap.appendChild(h('textarea', { class: 'input mono', rows: '20', readonly: true, text: data.text }));
          return wrap;
        },
      }, api);
    },
  });

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
    let mode = 'create', source = '', outputDir = '', archive = '', destination = '', archiveName = 'archive.zip';
    const status = h('div');
    const fields = h('div', { class: 'group-body' });
    const draw = () => {
      clear(fields);
      const choose = (label, key) => h('button', { class: 'btn btn-sm', type: 'button', text: `${label}: ${({ source, outputDir, archive, destination })[key] || 'Choose…'}`, onclick: async () => {
        if (key === 'archive') { const files = await api.pickFiles(); if (files?.[0]) archive = files[0].path; }
        else { const folder = await api.pickFolder(label); if (folder) ({ source, outputDir, destination }[key] = folder); }
        draw();
      } });
      const name = h('input', { class: 'input', type: 'text', value: archiveName, placeholder: 'archive.zip', oninput: e => { archiveName = e.target.value; } });
      fields.appendChild(h('div', { class: 'field-row' }, [h('button', { class: `settings-mode-btn${mode === 'create' ? ' active' : ''}`, text: 'Create ZIP', onclick: () => { mode = 'create'; draw(); } }), h('button', { class: `settings-mode-btn${mode === 'extract' ? ' active' : ''}`, text: 'Extract ZIP', onclick: () => { mode = 'extract'; draw(); } })]));
      if (mode === 'create') fields.appendChild(h('div', { class: 'field-row' }, [choose('Source folder', 'source'), choose('Save in folder', 'outputDir'), name]));
      else fields.appendChild(h('div', { class: 'field-row' }, [choose('ZIP file', 'archive'), choose('Extract into', 'destination')]));
      fields.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-accent', type: 'button', text: mode === 'create' ? 'Create archive' : 'Extract archive', onclick: async e => {
        if (mode === 'create' ? (!source || !outputDir) : (!archive || !destination)) { api.toast('Choose the required paths first', 'error'); return; }
        if (mode === 'create' && !/^[^\\/:*?"<>|]+\.zip$/i.test(name.value)) { api.toast('Enter a valid .zip filename', 'error'); return; }
        if (!window.confirm(mode === 'create' ? `Create ${name.value} from this folder?` : 'Extract the selected archive here? Existing files may be overwritten.')) return;
        const button = e.currentTarget;
        button.disabled = true; button.textContent = mode === 'create' ? 'Creating…' : 'Extracting…';
        const result = await api.invoke('archive', mode === 'create' ? { operation: 'create', root: source, outputDir, name: name.value } : { operation: 'extract', archive, destination });
        button.disabled = false; button.textContent = mode === 'create' ? 'Create archive' : 'Extract archive';
        if (!result.ok) api.toast(result.error, 'error'); else api.toast(mode === 'create' ? `Archive created: ${result.data.output}` : `Extracted to ${result.data.destination}`, 'ok');
      } })]));
    };
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Archive Tool' }), h('p', { class: 'tool-desc', text: 'Create and extract ZIP archives. Large archives may take a while.' })]));
    root.appendChild(h('div', { class: 'group' }, [fields])); root.appendChild(status); draw(); return root;
  } });

  Hub.registerView('watch-folder', { render(api) {
    const root = h('div', { class: 'tool' }), status = h('div', { class: 'results' });
    const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
    const state = { folder: '', watching: false, poll: null };
    const drawStatus = data => {
      state.watching = !!data?.watching;
      start.textContent = state.watching ? 'Stop watching' : 'Start watching';
      clear(status);
      status.appendChild(statusNote(data?.lastError ? `Watcher error: ${data.lastError}` : state.watching ? `Watching ${data.folder} · moved ${data.moved} · waiting for ${data.waiting} file(s) to finish` : data?.folder ? 'Watcher stopped.' : 'Not watching.', data?.lastError ? 'error' : 'info'));
      if (data?.log?.length) status.appendChild(h('div', { class: 'log' }, data.log.slice(0, 8).map(entry => h('div', { class: `log-line${entry.message.includes('Could not') || entry.message.includes('failed') ? ' log-err' : ''}`, text: `${new Date(entry.at).toLocaleTimeString()} · ${entry.message}` }))));
    };
    const start = h('button', { class: 'btn btn-accent', type: 'button', text: 'Start watching', onclick: async () => {
      if (state.watching) { const result = await api.invoke('stop', { folder: state.folder }); if (result.ok) drawStatus(result.data); else api.toast(result.error, 'error'); return; }
      if (!state.folder) { api.toast('Choose a folder first', 'error'); return; }
      let rules = []; try { rules = JSON.parse(localStorage.getItem('toolhub_org_rules_v1') || '[]').filter(rule => rule.dest); } catch {}
      const result = await api.invoke('start', { folder: state.folder, rules });
      if (!result.ok) { api.toast(result.error, 'error'); return; }
      drawStatus(result.data);
    } });
    const pick = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose folder', onclick: async () => { const folder = await api.pickFolder('Folder to watch'); if (folder) { state.folder = folder; folderLabel.textContent = folder; folderLabel.classList.remove('empty'); const result = await api.invoke('status', { folder }); if (result.ok) drawStatus(result.data); } } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Watch Folder' }), h('p', { class: 'tool-desc', text: 'Automatically apply saved Organizer rules while Tool Hub is running, even when you switch to another tool.' })]));
    root.appendChild(h('div', { class: 'action-row' }, [pick, folderLabel, start])); root.appendChild(status);
    state.poll = setInterval(async () => {
      if (!root.isConnected) { clearInterval(state.poll); return; }
      if (!state.folder) return;
      const result = await api.invoke('status', { folder: state.folder });
      if (result.ok) drawStatus(result.data);
    }, 1500);
    return root;
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
      workflows = [workflow, ...workflows.filter(item => item.id !== workflow.id)].slice(0, 30); try { localStorage.setItem(KEY, JSON.stringify(workflows)); } catch { api.toast('Workflow could not be saved', 'error'); return; } selected = workflow; drawWorkflows(); workflowSelect.value = '0'; api.toast('Workflow saved', 'ok');
    } });
    const pickFolder = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose source folder', onclick: async () => { const result = await api.pickFolder('Workflow source folder'); if (result) { folder = result; folderLabel.textContent = result; folderLabel.classList.remove('empty'); } } });
    const pickArchiveFolder = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose archive folder', onclick: async () => { const result = await api.pickFolder('Archive output folder'); if (result) { archiveFolder = result; archiveFolderLabel.textContent = result; archiveFolderLabel.classList.remove('empty'); } } });
    const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Run workflow', onclick: async () => {
      // Always run what the form shows, so edits made after loading a saved workflow are honoured.
      const workflow = { rename: doRename.checked, template: template.value || '{original}', organize: doOrganize.checked, archive: doArchive.checked, archiveName: archiveName.value, name: wfName.value || selected?.name || 'Workflow' };
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
            const dest = String(rule.dest).trim().replace(/[\\/]+$/, '').replace(/\{year\}/gi, file.tags?.DateTaken?.slice(0, 4) || new Date(file.mtime).getFullYear()).replace(/\{month\}/gi, file.tags?.DateTaken?.slice(5, 7) || String(new Date(file.mtime).getMonth() + 1).padStart(2, '0'));
            // Skip files that already sit in (or below) their destination instead of failing the whole run.
            const currentDir = String(file.relativePath || file.name).split(/[\\/]/).slice(0, -1).join('/').toLowerCase();
            const destKey = dest.replace(/\\/g, '/').toLowerCase();
            if (currentDir === destKey || currentDir.startsWith(`${destKey}/`)) continue;
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
        try { let history = JSON.parse(localStorage.getItem('toolhub_workflow_history_v1') || '[]'); if (!Array.isArray(history)) history = []; history.unshift({ name: workflow.name, at: Date.now(), preview, log }); localStorage.setItem('toolhub_workflow_history_v1', JSON.stringify(history.slice(0, 50))); } catch {}
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
})();
