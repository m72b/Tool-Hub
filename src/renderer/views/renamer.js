(function () {
  const { h, clear, fmtBytes, fmtDate, fmtNumber, table, empty, statusNote, stat } = window.UI;
  const Hub = window.Hub;

  const PRESET_KEY = 'toolhub_presets_v1';
  const OVERRIDE_KEY = 'toolhub_overrides_v1';
  const BUILTIN_TOKENS = ['{TrackNumber}', '{TrackName}', '{Artist}', '{Album}', '{Year}', '{ext}', '{original}', '{UPPER}', '{lower}', '{n}'];

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
      '{ext}': ext,
      '{original}': base,
      '{UPPER}': base.toUpperCase(),
      '{lower}': base.toLowerCase(),
      '{n}': String(index + 1).padStart(2, '0'),
    };
    let out = format;
    for (const [token, value] of Object.entries(map)) {
      out = out.split(token).join(value);
    }
    for (const [token, value] of Object.entries(overrides)) {
      out = out.split(`{${token}}`).join(value);
    }
    out = out.replace(/\{[^}]*\}/g, '').trim();
    if (out.length === 0) return file.name;
    if (ext && !out.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) out = `${out}.${ext}`;
    return out.replace(/[\\/:*?"<>|]/g, '_');
  }

  Hub.registerView('renamer', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const state = {
        folder: '',
        files: [],
        format: '{original}',
        overrides: readJson(OVERRIDE_KEY, {}),
        presets: readJson(PRESET_KEY, []),
        sort: 'name',
        rule: { enabled: false, find: '', replace: '' },
      };

      const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
      const results = h('div', { class: 'results' });
      const formatInput = h('textarea', { class: 'input mono', rows: '2', spellcheck: 'false', text: state.format });
      const previewLine = h('div', { class: 'preview-line' });

      function sortedFiles() {
        const list = [...state.files];
        if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
        else if (state.sort === 'size') list.sort((a, b) => b.size - a.size);
        else if (state.sort === 'date') list.sort((a, b) => b.mtime - a.mtime);
        return list;
      }

      function computeNames() {
        const list = sortedFiles();
        list.forEach((file, index) => {
          if (state.rule.enabled && state.rule.find) {
            if (file.name.toLowerCase().includes(state.rule.find.toLowerCase())) {
              const { ext } = baseAndExt(file.name);
              const replacement = state.rule.replace || file.name;
              file.newName = ext && !replacement.toLowerCase().endsWith(`.${ext.toLowerCase()}`)
                ? `${replacement}.${ext}`
                : replacement;
            } else {
              file.newName = file.name;
            }
            return;
          }
          file.newName = applyTemplate(state.format, file, index, state.overrides);
        });
        return list;
      }

      function updatePreview() {
        const list = computeNames();
        previewLine.textContent = list.length > 0
          ? `Preview: ${list[0].name}  →  ${list[0].newName}`
          : 'Preview: load a folder to see results';
      }

      async function loadFolder(folder) {
        const res = await api.invoke('readFolder', { folder });
        if (!res.ok) {
          api.toast(res.error, 'error');
          return;
        }
        state.folder = res.data.folder;
        state.files = res.data.files.map(f => ({ ...f, newName: f.name, status: 'idle' }));
        drawList();
        updatePreview();
      }

      async function saveOne(file, inputEl) {
        if (file.newName === file.name) return true;
        const res = await api.invoke('rename', { folder: state.folder, oldName: file.name, newName: file.newName });
        if (!res.ok) {
          file.status = 'error';
          api.toast(`${file.name}: ${res.error}`, 'error');
          if (inputEl) inputEl.classList.add('bad');
          return false;
        }
        file.name = file.newName;
        file.status = 'saved';
        if (inputEl) {
          inputEl.classList.remove('bad');
          inputEl.classList.add('good');
        }
        return true;
      }

      function drawList() {
        clear(results);
        if (!state.folder) {
          results.appendChild(empty('Choose a folder to begin.'));
          return;
        }
        const list = computeNames();
        if (list.length === 0) {
          results.appendChild(empty('No files in this folder.'));
          return;
        }

        results.appendChild(h('div', { class: 'stat-row' }, [
          stat('Files', fmtNumber(list.length)),
          stat('Pending changes', fmtNumber(list.filter(f => f.newName !== f.name).length), 'warn'),
        ]));

        const saveAll = h('button', {
          class: 'btn btn-accent', type: 'button', text: 'Save all changes',
          onclick: async () => {
            saveAll.disabled = true;
            let ok = 0;
            for (const file of list) {
              if (file.newName === file.name) continue;
              if (await saveOne(file)) ok++;
            }
            saveAll.disabled = false;
            api.toast(`Renamed ${ok} file(s)`, ok > 0 ? 'ok' : 'error');
            loadFolder(state.folder);
          },
        });

        const revert = h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Revert',
          onclick: () => {
            state.format = '{original}';
            formatInput.value = state.format;
            state.rule.enabled = false;
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
                  if (await saveOne(file, input)) api.toast('Renamed', 'ok');
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
                  file.newName = ext ? `${label}.${ext}` : label;
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

      const tokenChips = h('div', { class: 'chips' }, BUILTIN_TOKENS.map(token => h('button', {
        class: 'chip', type: 'button', text: token,
        onclick: () => {
          state.format = `${formatInput.value}${token}`;
          formatInput.value = state.format;
          updatePreview();
        },
      })));

      const applyBtn = h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Apply template',
        onclick: () => {
          state.rule.enabled = false;
          ruleToggle.checked = false;
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

      const ruleFind = h('input', { class: 'input', type: 'text', placeholder: 'Find in filename' });
      const ruleReplace = h('input', { class: 'input', type: 'text', placeholder: 'Rename matches to' });
      const ruleToggle = h('input', {
        type: 'checkbox',
        onchange: e => {
          state.rule.enabled = e.target.checked;
          state.rule.find = ruleFind.value;
          state.rule.replace = ruleReplace.value;
          drawList();
          updatePreview();
        },
      });
      ruleFind.oninput = e => {
        state.rule.find = e.target.value;
        if (state.rule.enabled) { drawList(); updatePreview(); }
      };
      ruleReplace.oninput = e => {
        state.rule.replace = e.target.value;
        if (state.rule.enabled) { drawList(); updatePreview(); }
      };

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'Batch Renamer' }),
        h('p', { class: 'tool-desc', text: 'Rename files in bulk using templates and tokens, with live previews and inline editing.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Folder' }),
            h('div', { class: 'field-row' }, [pick, folderLabel]),
          ]),
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Filename template' }),
            formatInput,
            tokenChips,
            previewLine,
          ]),
        ]),
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
          h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Filename rule' })]),
          h('div', { class: 'group-body' }, [
            h('label', { class: 'field field-inline' }, [ruleToggle, h('span', { text: 'Rename only files containing a phrase' })]),
            ruleFind,
            ruleReplace,
          ]),
        ]),
      ]));

      container.appendChild(results);
      drawOverrides();
      drawPresets();
      updatePreview();
      results.appendChild(empty('Choose a folder to begin.'));
      return container;
    },
  });

  Hub.registerView('organizer', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const RULES_KEY = 'toolhub_org_rules_v1';
      const state = {
        folder: '',
        rules: readJson(RULES_KEY, []),
      };

      const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
      const rulesBox = h('div', { class: 'rule-list' });
      const results = h('div', { class: 'results' });

      function saveRules() {
        writeJson(RULES_KEY, state.rules);
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
        const res = await api.invoke('readFolder', { folder: state.folder });
        if (!res.ok) {
          api.toast(res.error, 'error');
          return;
        }
        const lines = [];
        let moved = 0;
        let failed = 0;
        for (const file of res.data.files) {
          const rule = valid.find(r => ruleMatches(r, file));
          if (!rule) continue;
          if (dryRun) {
            lines.push({ ok: true, text: `Would move ${file.name} → ${rule.dest}/` });
            moved++;
            continue;
          }
          const move = await api.invoke('move', { folder: state.folder, fileName: file.name, destFolder: rule.dest.trim() });
          if (move.ok) {
            lines.push({ ok: true, text: `Moved ${file.name} → ${rule.dest}/` });
            moved++;
          } else {
            lines.push({ ok: false, text: `${file.name}: ${move.error}` });
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

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'File Organizer' }),
        h('p', { class: 'tool-desc', text: 'Sort files into subfolders using filename patterns, modified year or size ranges.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Source folder' }),
            h('div', { class: 'field-row' }, [pick, folderLabel]),
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
      container.appendChild(results);
      drawRules();
      results.appendChild(empty('Add rules, then preview before organizing.'));
      return container;
    },
  });
})();
