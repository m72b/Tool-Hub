(function () {
  const { h, clear, fmtBytes, fmtDate, fmtNumber, table, empty, statusNote, stat } = window.UI;
  const Hub = window.Hub;

  const PRESET_KEY = 'toolhub_presets_v1';
  const OVERRIDE_KEY = 'toolhub_overrides_v1';
  const BUILTIN_TOKENS = ['{TrackNumber}', '{TrackName}', '{Artist}', '{Album}', '{Year}', '{ext}', '{original}', '{UPPER}', '{lower}', '{TitleCase}', '{SentenceCase}', '{n}'];

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function baseAndExt(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return { base: name, ext: '' };
    return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
  }

  function applyTemplate(format, file, index, overrides) {
    const { base, ext } = baseAndExt(file.name);
    const map = {
      '{TrackNumber}': file.tags?.TrackNumber || '',
      '{TrackName}': file.tags?.TrackName || '',
      '{Artist}': file.tags?.Artist || '',
      '{Album}': file.tags?.Album || '',
      '{Year}': file.tags?.Year || '',
      '{ext}': ext,
      '{original}': base,
      '{UPPER}': base.toUpperCase(),
      '{lower}': base.toLowerCase(),
      '{TitleCase}': base.split(/(\s+)/).map(word => word.trim() ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word).join(''),
      '{SentenceCase}': base.toLowerCase().replace(/[a-z\u00c0-\u024f]/i, char => char.toUpperCase()),
      '{n}': String(index + 1).padStart(2, '0'),
    };
    let out = format;
    for (const [token, value] of Object.entries(map)) {
      out = out.split(token).join(value);
    }
    for (const [token, value] of Object.entries(overrides)) {
      out = out.split(`{${token}}`).join(value);
    }
    out = out.replace(/\{[^}]*\}/g, '').replace(/^\s*[-_.]+|[-_.]+\s*$/g, '').trim();
    if (out.length === 0) return file.name;
    if (ext && !out.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) out = `${out}.${ext}`;
    return out.replace(/[\\/:*?"<>|]/g, '_');
  }

  const CAPTURE_NOISE_WORDS = ['screenshot', 'screenshots', 'clip', 'clips', 'capture', 'captures', 'recording', 'recordings', 'gameplay', 'highlight', 'highlights', 'video', 'trim', 'edit', 'edited', 'export'];
  const DATE_LIKE = /\d{4}[.\-_ ]\d{1,2}[.\-_ ]\d{1,2}(?:[.\-_ ]\d{1,2}[.\-_ ]\d{1,2}(?:[.\-_ ]\d{1,2})?)?|\d{1,2}[.\-_ ]\d{1,2}[.\-_ ]\d{4}/;

  function detectGameName(name) {
    const { base } = baseAndExt(name);
    let candidate = base;

    const match = candidate.match(DATE_LIKE);
    if (match && match.index === 0) return base;
    if (match && match.index > 0) {
      candidate = candidate.slice(0, match.index);
    }

    candidate = candidate.replace(/[-_ .]+$/, '');
    candidate = candidate.replace(/\s*\(\d+\)\s*$/, '');
    candidate = candidate.replace(/[-_ ]?[0-9a-f]{8,}$/i, '');
    candidate = candidate.replace(/_+/g, ' ');

    const noisePattern = new RegExp(`\\b(${CAPTURE_NOISE_WORDS.join('|')})\\b`, 'gi');
    candidate = candidate.replace(noisePattern, ' ');

    candidate = candidate.replace(/\s+/g, ' ').trim();
    return candidate.length > 0 ? candidate : base;
  }

  function parseRemoveTerms(raw) {
    return String(raw || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function stripTerms(text, terms, caseInsensitive) {
    let out = text;
    for (const term of terms) {
      if (!term) continue;
      if (caseInsensitive) {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'gi'), '');
      } else {
        out = out.split(term).join('');
      }
    }
    return out.replace(/[-_ ]{2,}/g, ' ').replace(/^[-_ .]+|[-_ .]+$/g, '').trim();
  }

  function dedupeNames(list) {
    const seen = new Map();
    for (const file of list) {
      const { base, ext } = baseAndExt(file.newName);
      const parent = String(file.relativePath || file.name).replace(/[^\\/]+$/, '');
      let candidate = file.newName;
      let key = `${parent}\0${candidate.toLowerCase()}`;
      let n = 1;
      while (seen.has(key)) {
        n = seen.get(key) + 1;
        seen.set(key, n);
        candidate = ext ? `${base} (${n}).${ext}` : `${base} (${n})`;
        key = `${parent}\0${candidate.toLowerCase()}`;
      }
      if (!seen.has(key)) seen.set(key, n);
      file.newName = candidate;
    }
    return list;
  }

  Hub.registerView('renamer', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const state = {
        folder: '',
        recursive: false,
        truncated: false,
        history: readJson('toolhub_rename_history_v1', []),
        files: [],
        format: '{original}',
        overrides: readJson(OVERRIDE_KEY, {}),
        presets: readJson(PRESET_KEY, []),
        sort: 'name',
        mode: 'template',
        findReplace: { find: '', replace: '' },
        regexFlags: 'gi',
        removeText: '',
        removeCaseInsensitive: true,
      };

      const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
      const results = h('div', { class: 'results' });
      const historyBox = h('div', { class: 'group' });
      let nameInputs = new WeakMap();
      const formatInput = h('textarea', { class: 'input mono', rows: '2', spellcheck: 'false', text: state.format });
      const previewLine = h('div', { class: 'preview-line' });

      function sortedFiles() {
        const list = [...state.files];
        if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
        else if (state.sort === 'size') list.sort((a, b) => b.size - a.size);
        else if (state.sort === 'date') list.sort((a, b) => b.mtime - a.mtime);
        return list;
      }

      function computeBase(file, index) {
        if (state.mode === 'game') {
          return detectGameName(file.name);
        }
        if (state.mode === 'findReplace') {
          const find = state.findReplace.find;
          const base = baseAndExt(file.name).base;
          if (!find || !base.toLowerCase().includes(find.toLowerCase())) return base;
          const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return base.replace(new RegExp(escaped, 'gi'), () => state.findReplace.replace);
        }
        if (state.mode === 'regex') {
          const base = baseAndExt(file.name).base;
          if (!state.findReplace.find) return base;
          try {
            let flags = String(state.regexFlags || 'gi').replace(/[^dgimsuvy]/g, '');
            if (!flags.includes('g')) flags += 'g';
            return base.replace(new RegExp(state.findReplace.find, flags), () => state.findReplace.replace);
          } catch { return base; }
        }
        return baseAndExt(applyTemplate(state.format, file, index, state.overrides)).base;
      }

      function drawHistory() {
        clear(historyBox);
        historyBox.appendChild(h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Rename history' })]));
        const body = h('div', { class: 'group-body' });
        if (state.history.length === 0) body.appendChild(h('span', { class: 'muted', text: 'Saved renames can be undone here.' }));
        else {
          const latest = state.history[0];
          const count = latest.items.length;
          const canUndo = state.folder && latest.folder === state.folder;
          body.appendChild(h('div', { class: 'action-row' }, [
            h('span', { class: 'muted', text: `${count} rename(s) · ${new Date(latest.createdAt).toLocaleString()}` }),
            h('button', {
              class: 'btn btn-sm', type: 'button', text: canUndo ? 'Undo latest rename' : 'Choose that folder to undo', disabled: !canUndo,
              onclick: async () => {
                const res = await api.invoke('renameBatch', { folder: latest.folder, items: latest.items.map(item => ({ oldName: item.to, newName: item.from, relativePath: item.currentPath })) });
                if (!res.ok) { api.toast(`Undo failed: ${res.error}`, 'error'); return; }
                state.history.shift();
                writeJson('toolhub_rename_history_v1', state.history);
                api.toast(`Undid ${res.data.renamed} rename(s)`, 'ok');
                await loadFolder(state.folder);
              },
            }),
          ]));
          body.appendChild(h('div', { class: 'log' }, latest.items.slice(0, 12).map(item => h('div', { class: 'log-line', text: `${item.from} → ${item.to}` }))));
        }
        historyBox.appendChild(body);
      }

      function recordHistory(folder, items) {
        if (!items.length) return;
        const operations = items.map(item => ({ ...item }));
        state.history.unshift({ id: Date.now(), folder, createdAt: Date.now(), items: operations });
        let total = state.history.reduce((sum, batch) => sum + batch.items.length, 0);
        while (state.history.length > 25 || total > 5000) {
          const removed = state.history.pop();
          if (!removed) break;
          total -= removed.items.length;
        }
        if (!writeJson('toolhub_rename_history_v1', state.history)) api.toast('Rename completed, but history could not be saved.', 'warn');
        drawHistory();
      }

      function computeNames() {
        const list = sortedFiles();
        const terms = parseRemoveTerms(state.removeText);
        list.forEach((file, index) => {
          const { ext } = baseAndExt(file.name);
          let base = computeBase(file, index);
          if (terms.length > 0) {
            const cleaned = stripTerms(base, terms, state.removeCaseInsensitive);
            if (cleaned) base = cleaned;
          }
          const newName = ext ? `${base}.${ext}` : base;
          file.newName = newName.replace(/[\\/:*?"<>|]/g, '_');
        });
        dedupeNames(list);
        return list;
      }

      function updatePreview() {
        const list = computeNames();
        for (const file of list) {
          const input = nameInputs.get(file);
          if (!input || document.activeElement === input) continue;
          input.value = file.newName;
          input.classList.toggle('same', file.newName === file.name);
        }
        previewLine.textContent = list.length > 0
          ? `Preview: ${list[0].name}  →  ${list[0].newName}`
          : 'Preview: load a folder to see results';
      }

      async function loadFolder(folder) {
        const res = await api.invoke('readFolder', { folder, recursive: state.recursive });
        if (!res.ok) {
          api.toast(res.error, 'error');
          return;
        }
        state.folder = res.data.folder;
        state.truncated = res.data.truncated === true;
        state.files = res.data.files.map(f => ({ ...f, newName: f.name, status: 'idle' }));
        drawList();
        updatePreview();
      }

      async function saveOne(file, inputEl) {
        if (file.newName === file.name) return true;
        const res = await api.invoke('rename', { folder: state.folder, oldName: file.name, relativePath: file.relativePath, newName: file.newName });
        if (!res.ok) {
          file.status = 'error';
          api.toast(`${file.name}: ${res.error}`, 'error');
          if (inputEl) inputEl.classList.add('bad');
          return false;
        }
        const oldName = file.name;
        const oldPath = file.relativePath;
        file.name = file.newName;
        file.relativePath = file.relativePath.replace(/[^\\/]+$/, () => file.newName);
        recordHistory(state.folder, [{ from: oldName, to: file.name, currentPath: file.relativePath, originalPath: oldPath }]);
        file.status = 'saved';
        if (inputEl) {
          inputEl.classList.remove('bad');
          inputEl.classList.add('good');
        }
        return true;
      }

      function drawList() {
        nameInputs = new WeakMap();
        clear(results);
        if (!state.folder) {
          results.appendChild(empty('Choose a folder to begin.'));
          drawHistory();
          results.appendChild(historyBox);
          return;
        }
        const list = computeNames();
        if (list.length === 0) {
          results.appendChild(empty('No files in this folder.'));
          drawHistory();
          results.appendChild(historyBox);
          return;
        }

        results.appendChild(h('div', { class: 'stat-row' }, [
          stat('Files', fmtNumber(list.length)),
          stat('Pending changes', fmtNumber(list.filter(f => f.newName !== f.name).length), 'warn'),
        ]));
        if (state.truncated) results.appendChild(statusNote('This folder contains more than 5,000 files. Preview and rename results are partial.', 'warn'));

        const saveAll = h('button', {
          class: 'btn btn-accent', type: 'button', text: 'Save all changes',
          onclick: async () => {
            saveAll.disabled = true;
            const pending = list.filter(file => file.newName !== file.name);
            if (pending.length === 0) { saveAll.disabled = false; return; }
            const res = await api.invoke('renameBatch', { folder: state.folder, items: pending.map(file => ({ oldName: file.name, relativePath: file.relativePath, newName: file.newName })) });
            saveAll.disabled = false;
            if (!res.ok) {
              for (const file of pending) file.status = 'error';
              drawList();
              api.toast(res.error, 'error');
              return;
            }
            recordHistory(state.folder, pending.map(file => ({ from: file.name, to: file.newName, currentPath: file.relativePath.replace(/[^\\/]+$/, () => file.newName), originalPath: file.relativePath })));
            api.toast(`Renamed ${res.data.renamed} file(s)`, 'ok');
            loadFolder(state.folder);
          },
        });

        const revert = h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Revert',
          onclick: () => {
            state.mode = 'template';
            state.format = '{original}';
            formatInput.value = state.format;
            state.findReplace = { find: '', replace: '' };
            ruleFind.value = '';
            ruleReplace.value = '';
            state.removeText = '';
            removeTextarea.value = '';
            state.removeCaseInsensitive = true;
            removeCI.checked = true;
            renderModeButtons();
            renderModeBody();
            drawList();
            updatePreview();
          },
        });

        const sortSelect = h('select', {
          class: 'input',
          onchange: e => {
            state.sort = e.target.value;
            drawList();
          },
        }, [
          h('option', { value: 'name', text: 'Sort by name', selected: state.sort === 'name' }),
          h('option', { value: 'size', text: 'Sort by size', selected: state.sort === 'size' }),
          h('option', { value: 'date', text: 'Sort by date', selected: state.sort === 'date' }),
        ]);

        results.appendChild(h('div', { class: 'action-row' }, [saveAll, revert, sortSelect]));

        const rows = list.map(file => {
          const input = h('input', {
            class: `input mono${file.newName === file.name ? ' same' : ''}`,
            type: 'text',
            value: file.newName,
            spellcheck: 'false',
            oninput: e => { file.newName = e.target.value; },
          });
          nameInputs.set(file, input);
          const isAudio = /^(mp3|flac|wav|aac|ogg|m4a|wma|opus)$/i.test(file.ext);
          return h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: file.name, title: file.name }),
            input,
            h('span', { class: 'mono', text: fmtBytes(file.size) }),
            h('span', { class: 'tag-row' }, [
              file.status === 'saved' ? h('span', { class: 'tag tag-ok', text: 'saved' }) : null,
              file.status === 'error' ? h('span', { class: 'tag tag-warn', text: 'error' }) : null,
            ].filter(Boolean)),
            h('div', { class: 'row-actions' }, [
              isAudio ? h('button', {
                class: 'mini-btn', type: 'button', text: 'Lookup',
                onclick: () => lookup(file, input),
              }) : null,
              h('button', {
                class: 'mini-btn', type: 'button', text: 'Save',
                onclick: async () => {
                  if (await saveOne(file, input)) {
                    api.toast('Renamed', 'ok');
                    drawList();
                    updatePreview();
                  }
                },
              }),
            ].filter(Boolean)),
          ]);
        });

        results.appendChild(table([
          { label: 'Original', width: 'minmax(0,1.2fr)' },
          { label: 'New name', width: 'minmax(0,1.6fr)' },
          { label: 'Size', width: '90px' },
          { label: 'State', width: '80px' },
          { label: '', width: '130px' },
        ], rows));
        drawHistory();
        results.appendChild(historyBox);
      }

      async function lookup(file, input) {
        const { base } = baseAndExt(file.name);
        api.toast('Searching MusicBrainz…', 'info');
        const res = await api.invoke('musicbrainz', { query: base });
        if (!res.ok) {
          api.toast(res.error, 'error');
          return;
        }
        const recordings = (res.data.data && res.data.data.recordings) || [];
        if (recordings.length === 0) {
          api.toast('No matches found', 'error');
          return;
        }
        const modal = h('div', { class: 'modal-bg open', onclick: e => { if (e.target === modal) modal.remove(); } }, [
          h('div', { class: 'modal-box' }, [
            h('div', { class: 'modal-title', text: 'MusicBrainz matches' }),
            h('div', { class: 'lookup-list' }, recordings.slice(0, 8).map(rec => {
              const artist = (rec['artist-credit'] || []).map(a => a.name).join(', ');
              const title = rec.title || '';
              const label = artist ? `${artist} - ${title}` : title;
              return h('button', {
                class: 'lookup-item', type: 'button',
                onclick: () => {
                  const { ext } = baseAndExt(file.name);
                  const safeLabel = label.replace(/[\\/:*?"<>|]/g, '_');
                  file.newName = ext ? `${safeLabel}.${ext}` : safeLabel;
                  input.value = file.newName;
                  input.classList.remove('same');
                  modal.remove();
                },
              }, [
                h('span', { class: 'lookup-title', text: label }),
                h('span', { class: 'lookup-sub', text: rec.length ? `${Math.round(rec.length / 1000)}s` : '' }),
              ]);
            })),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Close', onclick: () => modal.remove() }),
          ]),
        ]);
        document.body.appendChild(modal);
      }

      formatInput.oninput = e => {
        state.format = e.target.value;
        updatePreview();
      };
      formatInput.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };

      const tokenChips = h('div', { class: 'chips' }, BUILTIN_TOKENS.map(token => h('button', {
        class: 'chip', type: 'button', text: token,
        onclick: () => {
          state.format = `${formatInput.value}${token}`;
          formatInput.value = state.format;
          updatePreview();
        },
      })));

      const applyBtn = h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Apply to list',
        onclick: () => {
          drawList();
          updatePreview();
        },
      });

      const pick = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Choose folder…',
        onclick: async () => {
          const chosen = await api.pickFolder('Folder to rename');
          if (!chosen) return;
          folderLabel.textContent = chosen;
          folderLabel.classList.remove('empty');
          loadFolder(chosen);
        },
      });
      const includeSubfolders = h('label', { class: 'field field-inline' }, [
        h('input', { type: 'checkbox', checked: false, onchange: e => { state.recursive = e.target.checked; if (state.folder) loadFolder(state.folder); } }),
        h('span', { text: 'Include subfolders' }),
      ]);

      const overrideList = h('div', { class: 'override-list' });
      function drawOverrides() {
        clear(overrideList);
        const entries = Object.entries(state.overrides);
        if (entries.length === 0) {
          overrideList.appendChild(h('span', { class: 'muted', text: 'No custom tokens yet.' }));
        }
        for (const [token, value] of entries) {
          overrideList.appendChild(h('div', { class: 'override-row' }, [
            h('span', { class: 'mono', text: `{${token}}` }),
            h('input', {
              class: 'input mono', type: 'text', value,
              oninput: e => {
                state.overrides[token] = e.target.value;
                writeJson(OVERRIDE_KEY, state.overrides);
                updatePreview();
              },
            }),
            h('button', {
              class: 'mini-btn mini-danger', type: 'button', text: 'Remove',
              onclick: () => {
                delete state.overrides[token];
                writeJson(OVERRIDE_KEY, state.overrides);
                drawOverrides();
                updatePreview();
              },
            }),
          ]));
        }
      }

      const newTokenInput = h('input', { class: 'input mono', type: 'text', placeholder: 'Artist' });
      const addToken = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Add token',
        onclick: () => {
          const name = newTokenInput.value.trim().replace(/[{}]/g, '');
          if (!name) return;
          state.overrides[name] = '';
          writeJson(OVERRIDE_KEY, state.overrides);
          newTokenInput.value = '';
          drawOverrides();
        },
      });

      const presetList = h('div', { class: 'preset-list' });
      function drawPresets() {
        clear(presetList);
        if (state.presets.length === 0) {
          presetList.appendChild(h('span', { class: 'muted', text: 'No presets saved.' }));
        }
        for (const preset of state.presets) {
          presetList.appendChild(h('div', { class: 'preset-row' }, [
            h('button', {
              class: 'link-btn ellipsis', type: 'button', text: preset.name, title: preset.format,
              onclick: () => {
                state.format = preset.format;
                formatInput.value = preset.format;
                state.mode = 'template';
                renderModeButtons();
                renderModeBody();
                drawList();
                updatePreview();
              },
            }),
            h('span', { class: 'mono muted ellipsis', text: preset.format }),
            h('button', {
              class: 'mini-btn mini-danger', type: 'button', text: '✕',
              onclick: () => {
                state.presets = state.presets.filter(p => p.id !== preset.id);
                writeJson(PRESET_KEY, state.presets);
                drawPresets();
              },
            }),
          ]));
        }
      }

      const presetName = h('input', { class: 'input', type: 'text', placeholder: 'Preset name' });
      const savePreset = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Save preset',
        onclick: () => {
          const name = presetName.value.trim();
          if (!name) return;
          state.presets.push({ id: Date.now(), name, format: state.format });
          writeJson(PRESET_KEY, state.presets);
          presetName.value = '';
          drawPresets();
          api.toast('Preset saved', 'ok');
        },
      });

      const ruleFind = h('input', {
        class: 'input', type: 'text', placeholder: 'Find in filename',
        oninput: e => { state.findReplace.find = e.target.value; updatePreview(); },
      });
      const ruleReplace = h('input', {
        class: 'input', type: 'text', placeholder: 'Rename matches to',
        oninput: e => { state.findReplace.replace = e.target.value; updatePreview(); },
      });
      const regexFind = h('input', {
        class: 'input mono', type: 'text', placeholder: 'Regex pattern',
        oninput: e => { state.findReplace.find = e.target.value; updatePreview(); },
      });
      const regexReplace = h('input', {
        class: 'input mono', type: 'text', placeholder: 'Replacement ($1, etc.)',
        oninput: e => { state.findReplace.replace = e.target.value; updatePreview(); },
      });
      const regexFlags = h('input', {
        class: 'input mono', type: 'text', value: state.regexFlags, placeholder: 'gi', title: 'Regex flags',
        oninput: e => { state.regexFlags = e.target.value; updatePreview(); },
      });

      const removeTextarea = h('textarea', {
        class: 'input mono', rows: '3', spellcheck: 'false',
        placeholder: '1440p\n(1)\nfinal',
        oninput: e => { state.removeText = e.target.value; updatePreview(); },
      });
      const removeCI = h('input', {
        type: 'checkbox', checked: true,
        onchange: e => { state.removeCaseInsensitive = e.target.checked; updatePreview(); },
      });

      const modeButtonsWrap = h('div', { class: 'shape-grid' });
      const modeBody = h('div', { class: 'mode-body' });
      const MODE_LABELS = { template: 'Template', findReplace: 'Find & Replace', regex: 'Regex', game: 'Detect Game Name' };

      function renderModeButtons() {
        clear(modeButtonsWrap);
        for (const m of ['template', 'findReplace', 'regex', 'game']) {
          modeButtonsWrap.appendChild(h('button', {
            class: `settings-mode-btn${state.mode === m ? ' active' : ''}`,
            type: 'button',
            text: MODE_LABELS[m],
            onclick: () => {
              state.mode = m;
              renderModeButtons();
              renderModeBody();
              drawList();
              updatePreview();
            },
          }));
        }
      }

      function renderModeBody() {
        clear(modeBody);
        if (state.mode === 'template') {
          modeBody.appendChild(h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Filename template' }),
            formatInput,
            tokenChips,
          ]));
        } else if (state.mode === 'findReplace') {
          modeBody.appendChild(h('div', { class: 'field-row' }, [ruleFind, ruleReplace]));
          modeBody.appendChild(h('span', { class: 'field-hint', text: 'Find and replace text in the filename before the extension. Leave replacement blank to remove matching text.' }));
        } else if (state.mode === 'regex') {
          modeBody.appendChild(h('div', { class: 'field-row' }, [regexFind, regexReplace, regexFlags]));
          modeBody.appendChild(h('span', { class: 'field-hint', text: 'Regular expression runs against the filename before its extension. Replacement supports JavaScript capture groups.' }));
        } else {
          modeBody.appendChild(statusNote(
            'Strips dates, timestamps and capture-software words from the filename, leaving what comes before them \u2014 for example "ArcRaiders-2026.09.24-20.15.32" becomes "ArcRaiders". Works best with ShadowPlay, Xbox Game Bar and similar tools that put the game name first. It reads the filename structure only, not a game database, so check the results before saving.',
            'info'
          ));
        }
        modeBody.appendChild(previewLine);
      }

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'Batch Renamer' }),
        h('p', { class: 'tool-desc', text: 'Rename files in bulk using templates and tokens, with live previews and inline editing.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Folder' }),
            h('div', { class: 'field-row' }, [pick, folderLabel, includeSubfolders]),
          ]),
        ]),
        h('div', { class: 'field field-wide' }, [
          h('label', { class: 'field-label', text: 'Naming mode' }),
          modeButtonsWrap,
        ]),
        modeBody,
        h('div', { class: 'controls-actions' }, [applyBtn]),
      ]));

      container.appendChild(h('div', { class: 'panel-grid' }, [
        h('div', { class: 'group' }, [
          h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Custom tokens' })]),
          h('div', { class: 'group-body' }, [overrideList, h('div', { class: 'field-row' }, [newTokenInput, addToken])]),
        ]),
        h('div', { class: 'group' }, [
          h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Presets' })]),
          h('div', { class: 'group-body' }, [presetList, h('div', { class: 'field-row' }, [presetName, savePreset])]),
        ]),
        h('div', { class: 'group' }, [
          h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Remove text' })]),
          h('div', { class: 'group-body' }, [
            h('span', { class: 'field-hint', text: 'One phrase per line. Removed from every filename after the naming mode above runs.' }),
            removeTextarea,
            h('label', { class: 'field field-inline' }, [removeCI, h('span', { text: 'Case-insensitive' })]),
          ]),
        ]),
      ]));

      container.appendChild(results);
      drawOverrides();
      drawPresets();
      renderModeButtons();
      renderModeBody();
      updatePreview();
      results.appendChild(empty('Choose a folder to begin.'));
      return container;
    },
  });

  Hub.registerView('organizer', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const RULES_KEY = 'toolhub_org_rules_v1';
      const HISTORY_KEY = 'toolhub_org_history_v1';
      const state = {
        folder: '',
        recursive: false,
        rules: readJson(RULES_KEY, []),
        history: readJson(HISTORY_KEY, []),
      };

      const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
      const rulesBox = h('div', { class: 'rule-list' });
      const results = h('div', { class: 'results' });
      const historyBox = h('div', { class: 'log' });

      function saveRules() {
        writeJson(RULES_KEY, state.rules);
      }

      function saveHistory() {
        let history = state.history.map(batch => ({ ...batch, moves: [...batch.moves] }));
        let moves = history.reduce((sum, batch) => sum + batch.moves.length, 0);
        let trimmed = false;
        while (moves > 2000) {
          const first = history[0];
          if (!first) break;
          const excess = moves - 2000;
          const drop = Math.min(excess, first.moves.length);
          first.moves.splice(0, drop);
          moves -= drop;
          trimmed = true;
          if (first.moves.length === 0) history.shift();
        }
        while (history.length > 0 && JSON.stringify(history).length > 1_500_000) {
          const oldest = history[0];
          if (oldest.moves.length > 0) {
            const drop = Math.max(1, Math.ceil(oldest.moves.length / 10));
            oldest.moves.splice(0, drop);
            moves -= drop;
          } else history.shift();
          trimmed = true;
        }
        let saved = writeJson(HISTORY_KEY, history);
        while (!saved && history.length > 0) {
          const oldest = history[0];
          if (oldest.moves.length > 0) oldest.moves.splice(0, Math.max(1, Math.ceil(oldest.moves.length / 10)));
          else history.shift();
          trimmed = true;
          saved = writeJson(HISTORY_KEY, history);
        }
        if (saved) state.history = history;
        if (trimmed) api.toast('Oldest move history was trimmed to fit local storage.', 'info');
        if (!saved) api.toast('Move history could not be saved. Undo may be unavailable after closing the app.', 'error');
        return saved;
      }

      function drawHistory() {
        clear(historyBox);
        if (state.history.length === 0) {
          historyBox.appendChild(empty('No files moved yet.'));
          return;
        }
        for (const batch of state.history) {
          const reversed = batch.moves.filter(move => move.reversed).length;
          const card = h('div', { class: 'history-entry' }, [
            h('div', { class: 'stat-row' }, [
              stat('Moved', fmtNumber(batch.moves.length)),
              stat('Reversed', fmtNumber(reversed)),
              h('button', {
                class: 'btn btn-sm', type: 'button',
                text: reversed === batch.moves.length ? 'Reversed' : 'Reverse moves',
                disabled: reversed === batch.moves.length,
                onclick: async () => {
                  let undone = 0;
                  let failed = 0;
                  for (const move of [...batch.moves].reverse()) {
                    if (move.reversed) continue;
                    const res = await api.invoke('reverseMove', {
                      folder: batch.folder, fromPath: move.to, toPath: move.from,
                    });
                    if (res.ok) {
                      move.reversed = true;
                      delete move.error;
                      undone++;
                    } else {
                      failed++;
                      move.error = res.error;
                    }
                  }
                  saveHistory();
                  drawHistory();
                  api.toast(`Reversed ${undone} file(s)${failed ? `; ${failed} failed` : ''}`, failed ? 'error' : 'ok');
                },
              }),
            ]),
            h('div', { class: 'muted', text: new Date(batch.createdAt).toLocaleString() }),
            h('div', { class: 'log' }, batch.moves.map(move =>
              h('div', { class: `log-line${move.reversed ? ' muted' : ''}`, text: `${move.from} → ${move.to}${move.reversed ? ' (reversed)' : ''}${move.error ? ` — ${move.error}` : ''}` }))),
          ]);
          historyBox.appendChild(card);
        }
      }

      function matchesPattern(name, pattern) {
        const p = pattern.trim();
        if (!p) return false;
        if (p.includes('*') || p.includes('?')) {
          const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
          return new RegExp(`^${escaped}$`, 'i').test(name);
        }
        return name.toLowerCase().includes(p.toLowerCase());
      }

      function unitBytes(unit) {
        return { KB: 1024, MB: 1048576, GB: 1073741824 }[unit] || 1048576;
      }

      function ruleMatches(rule, file) {
        if (rule.type === 'date') {
          const year = new Date(file.mtime).getFullYear();
          const from = rule.dateFrom ? Number(rule.dateFrom) : null;
          const to = rule.dateTo ? Number(rule.dateTo) : null;
          if (from !== null && year < from) return false;
          if (to !== null && year > to) return false;
          return from !== null || to !== null;
        }
        if (rule.type === 'size') {
          const min = rule.sizeMin ? Number(rule.sizeMin) * unitBytes(rule.sizeMinUnit) : null;
          const max = rule.sizeMax ? Number(rule.sizeMax) * unitBytes(rule.sizeMaxUnit) : null;
          if (min !== null && file.size < min) return false;
          if (max !== null && file.size > max) return false;
          return min !== null || max !== null;
        }
        return matchesPattern(file.name, rule.match || '');
      }

      function drawRules() {
        clear(rulesBox);
        if (state.rules.length === 0) {
          rulesBox.appendChild(h('span', { class: 'muted', text: 'No rules yet — add one below.' }));
        }
        state.rules.forEach((rule, index) => {
          const typeSelect = h('select', {
            class: 'input',
            onchange: e => {
              rule.type = e.target.value;
              saveRules();
              drawRules();
            },
          }, [
            h('option', { value: 'pattern', text: 'Filename pattern', selected: rule.type === 'pattern' }),
            h('option', { value: 'date', text: 'Modified year', selected: rule.type === 'date' }),
            h('option', { value: 'size', text: 'File size', selected: rule.type === 'size' }),
          ]);

          const fields = [];
          if (rule.type === 'date') {
            fields.push(h('input', { class: 'input', type: 'number', placeholder: 'From year', value: rule.dateFrom || '', oninput: e => { rule.dateFrom = e.target.value; saveRules(); } }));
            fields.push(h('input', { class: 'input', type: 'number', placeholder: 'To year', value: rule.dateTo || '', oninput: e => { rule.dateTo = e.target.value; saveRules(); } }));
          } else if (rule.type === 'size') {
            fields.push(h('input', { class: 'input', type: 'number', placeholder: 'Min', value: rule.sizeMin || '', oninput: e => { rule.sizeMin = e.target.value; saveRules(); } }));
            fields.push(h('select', { class: 'input', onchange: e => { rule.sizeMinUnit = e.target.value; saveRules(); } },
              ['KB', 'MB', 'GB'].map(u => h('option', { value: u, text: u, selected: (rule.sizeMinUnit || 'MB') === u }))));
            fields.push(h('input', { class: 'input', type: 'number', placeholder: 'Max', value: rule.sizeMax || '', oninput: e => { rule.sizeMax = e.target.value; saveRules(); } }));
            fields.push(h('select', { class: 'input', onchange: e => { rule.sizeMaxUnit = e.target.value; saveRules(); } },
              ['KB', 'MB', 'GB'].map(u => h('option', { value: u, text: u, selected: (rule.sizeMaxUnit || 'MB') === u }))));
          } else {
            fields.push(h('input', { class: 'input mono', type: 'text', placeholder: '*.mp3 or part of a name', value: rule.match || '', oninput: e => { rule.match = e.target.value; saveRules(); } }));
          }

          rulesBox.appendChild(h('div', { class: 'rule' }, [
            h('div', { class: 'rule-top' }, [
              typeSelect,
              h('button', {
                class: 'mini-btn mini-danger', type: 'button', text: '✕',
                onclick: () => {
                  state.rules.splice(index, 1);
                  saveRules();
                  drawRules();
                },
              }),
            ]),
            h('div', { class: 'rule-fields' }, [
              ...fields,
              h('span', { class: 'muted', text: '→' }),
              h('input', { class: 'input', type: 'text', placeholder: 'destination subfolder', value: rule.dest || '', oninput: e => { rule.dest = e.target.value; saveRules(); } }),
            ]),
          ]));
        });
      }

      async function execute(dryRun) {
        if (!state.folder) {
          api.toast('Choose a source folder', 'error');
          return;
        }
        const valid = state.rules.filter(r => (r.dest || '').trim());
        if (valid.length === 0) {
          api.toast('Add at least one rule with a destination', 'error');
          return;
        }
        const res = await api.invoke('readFolder', { folder: state.folder, recursive: state.recursive });
        if (!res.ok) {
          api.toast(res.error, 'error');
          return;
        }
        const lines = [];
        const successfulMoves = [];
        let moved = 0;
        let failed = 0;
        for (const file of res.data.files) {
          const rule = valid.find(r => ruleMatches(r, file));
          if (!rule) continue;
          const relativeParts = String(file.relativePath || file.name).split(/[\\/]/);
          if (relativeParts.length === 2 && relativeParts[0].toLowerCase() === rule.dest.trim().toLowerCase()) continue;
          if (dryRun) {
            lines.push({ ok: true, text: `Would move ${file.relativePath || file.name} → ${rule.dest}/` });
            moved++;
            continue;
          }
          const move = await api.invoke('move', { folder: state.folder, fileName: file.name, relativePath: file.relativePath, destFolder: rule.dest.trim() });
          if (move.ok) {
            lines.push({ ok: true, text: `Moved ${move.data.from} → ${move.data.to}` });
            successfulMoves.push({ from: move.data.from, to: move.data.to, reversed: false });
            moved++;
          } else {
            lines.push({ ok: false, text: `${file.relativePath || file.name}: ${move.error}` });
            failed++;
          }
        }
        clear(results);
        results.appendChild(h('div', { class: 'stat-row' }, [
          stat(dryRun ? 'Would move' : 'Moved', fmtNumber(moved), 'ok'),
          stat('Failed', fmtNumber(failed), failed > 0 ? 'warn' : null),
        ]));
        if (lines.length === 0) {
          results.appendChild(empty('No files matched your rules.'));
          return;
        }
        results.appendChild(h('div', { class: 'log' }, lines.slice(0, 500).map(line =>
          h('div', { class: `log-line${line.ok ? '' : ' log-err'}`, text: line.text }))));
        if (!dryRun && successfulMoves.length > 0) {
          state.history.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, folder: state.folder, createdAt: Date.now(), moves: successfulMoves });
          state.history = state.history.slice(0, 50);
          saveHistory();
          drawHistory();
        }
      }

      const pick = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Choose folder…',
        onclick: async () => {
          const chosen = await api.pickFolder('Folder to organize');
          if (!chosen) return;
          state.folder = chosen;
          folderLabel.textContent = chosen;
          folderLabel.classList.remove('empty');
        },
      });
      const includeSubfolders = h('label', { class: 'field field-inline' }, [
        h('input', { type: 'checkbox', checked: false, onchange: e => { state.recursive = e.target.checked; } }),
        h('span', { text: 'Include subfolders' }),
      ]);

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'File Organizer' }),
        h('p', { class: 'tool-desc', text: 'Sort files into subfolders using filename patterns, modified year or size ranges.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Source folder' }),
            h('div', { class: 'field-row' }, [pick, folderLabel, includeSubfolders]),
          ]),
        ]),
        h('div', { class: 'controls-actions' }, [
          h('button', { class: 'btn', type: 'button', text: 'Preview', onclick: () => execute(true) }),
          h('button', { class: 'btn btn-accent', type: 'button', text: 'Organize files', onclick: () => execute(false) }),
        ]),
      ]));
      container.appendChild(h('div', { class: 'group' }, [
        h('div', { class: 'group-head' }, [
          h('span', { class: 'group-title', text: 'Rules' }),
          h('button', {
            class: 'btn btn-sm', type: 'button', text: 'Add rule',
            onclick: () => {
              state.rules.push({ type: 'pattern', match: '', dest: '' });
              saveRules();
              drawRules();
            },
          }),
        ]),
        h('div', { class: 'group-body' }, [rulesBox]),
      ]));
      container.appendChild(h('div', { class: 'group' }, [
        h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Move history' })]),
        h('div', { class: 'group-body' }, [historyBox]),
      ]));
      container.appendChild(results);
      drawRules();
      drawHistory();
      results.appendChild(empty('Add rules, then preview before organizing.'));
      return container;
    },
  });

  window.RenamerLogic = { baseAndExt, applyTemplate, detectGameName, stripTerms, parseRemoveTerms, dedupeNames };
})();
