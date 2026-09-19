(function () {
  const { h, clear, fmtBytes, fmtDate, fmtNumber, table, empty, statusNote, stat, toolShell } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('folder-compare', {
    render(api) {
      return toolShell({
        title: 'Folder Compare',
        description: 'Compare two folders and identify files that are missing, added or changed.',
        action: 'compare',
        runLabel: 'Compare folders',
        busyLabel: 'Comparing…',
        defaults: { left: '', right: '', mode: 'size', recursive: true },
        fields: [
          { type: 'folder', key: 'left', label: 'Left folder', wide: true },
          { type: 'folder', key: 'right', label: 'Right folder', wide: true },
          {
            type: 'select', key: 'mode', label: 'Compare by', options: [
              { label: 'Name and size', value: 'size' },
              { label: 'Name, size and contents', value: 'hash' },
              { label: 'Name only', value: 'name' },
            ],
          },
          { type: 'checkbox', key: 'recursive', label: 'Include subfolders' },
        ],
        validate: s => {
          if (!s.left || !s.right) return 'Choose both folders';
          if (s.left === s.right) return 'Choose two different folders';
          return null;
        },
        render(data) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [
            stat('Identical', fmtNumber(data.counts.identical), 'ok'),
            stat('Different', fmtNumber(data.counts.different), 'warn'),
            stat('Only left', fmtNumber(data.counts.onlyLeft)),
            stat('Only right', fmtNumber(data.counts.onlyRight)),
          ]));
          if (data.truncated) wrap.appendChild(statusNote('One of the folders hit the file limit; results are partial.', 'warn'));

          const section = (title, rows, cols) => {
            if (rows.length === 0) return null;
            return h('div', { class: 'group' }, [
              h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: title })]),
              table(cols, rows),
            ]);
          };

          const diffRows = data.different.map(d => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: d.rel, title: d.rel }),
            h('span', { class: 'tag tag-warn', text: d.reason }),
            h('span', { class: 'mono', text: fmtBytes(d.leftSize) }),
            h('span', { class: 'mono', text: fmtBytes(d.rightSize) }),
          ]));
          const leftRows = data.onlyLeft.map(d => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: d.rel, title: d.rel }),
            h('span', { class: 'mono', text: fmtBytes(d.size) }),
            h('span', { class: 'muted', text: fmtDate(d.mtime) }),
          ]));
          const rightRows = data.onlyRight.map(d => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: d.rel, title: d.rel }),
            h('span', { class: 'mono', text: fmtBytes(d.size) }),
            h('span', { class: 'muted', text: fmtDate(d.mtime) }),
          ]));

          const onlyCols = [
            { label: 'File', width: 'minmax(0,2fr)' },
            { label: 'Size', width: '110px' },
            { label: 'Modified', width: '150px' },
          ];
          const parts = [
            section('Different', diffRows, [
              { label: 'File', width: 'minmax(0,2fr)' },
              { label: 'Reason', width: '100px' },
              { label: 'Left', width: '110px' },
              { label: 'Right', width: '110px' },
            ]),
            section('Only in left folder', leftRows, onlyCols),
            section('Only in right folder', rightRows, onlyCols),
          ].filter(Boolean);

          if (parts.length === 0) {
            wrap.appendChild(empty('The folders match.'));
            return wrap;
          }
          for (const part of parts) wrap.appendChild(part);
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('hash-tool', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const state = { algo: 'sha256', files: [] };

      const results = h('div', { class: 'results' });
      const fileLabel = h('span', { class: 'path-display empty', text: 'No files selected' });

      const algoSelect = h('select', {
        class: 'input',
        onchange: e => { state.algo = e.target.value; },
      }, ['md5', 'sha1', 'sha256', 'sha512'].map(a => h('option', { value: a, text: a.toUpperCase(), selected: a === 'sha256' })));

      const pick = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Choose files…',
        onclick: async () => {
          const files = await api.pickFiles();
          if (!files || files.length === 0) return;
          state.files = files.map(f => f.path);
          fileLabel.textContent = `${files.length} file(s) selected`;
          fileLabel.classList.remove('empty');
        },
      });

      const runBtn = h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Generate hashes',
        onclick: async () => {
          if (state.files.length === 0) {
            api.toast('Choose files first', 'error');
            return;
          }
          runBtn.disabled = true;
          runBtn.textContent = 'Hashing…';
          const res = await api.invoke('hashFiles', { paths: state.files, algo: state.algo });
          runBtn.disabled = false;
          runBtn.textContent = 'Generate hashes';
          clear(results);
          if (!res.ok) {
            results.appendChild(statusNote(res.error, 'error'));
            return;
          }
          const rows = res.data.results.map(r => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: r.name, title: r.path }),
            h('span', { class: 'mono', text: r.ok ? fmtBytes(r.size) : '—' }),
            r.ok
              ? h('span', { class: 'mono hash-cell', text: r.hash, title: r.hash })
              : h('span', { class: 'error-text', text: r.error }),
            h('button', {
              class: 'mini-btn', type: 'button', text: 'Copy',
              onclick: async () => {
                if (!r.ok) return;
                await navigator.clipboard.writeText(r.hash);
                api.toast('Hash copied', 'ok');
              },
            }),
          ]));
          results.appendChild(table([
            { label: 'File', width: 'minmax(0,1fr)' },
            { label: 'Size', width: '90px' },
            { label: res.data.algo.toUpperCase(), width: 'minmax(0,2fr)' },
            { label: '', width: '70px' },
          ], rows));
        },
      });

      const verifyPath = { value: '' };
      const verifyLabel = h('span', { class: 'path-display empty', text: 'No file selected' });
      const expectedInput = h('input', { class: 'input', type: 'text', placeholder: 'Paste the expected checksum', spellcheck: 'false' });
      const verifyOut = h('div', { class: 'verify-out' });

      const verifyPick = h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Choose file…',
        onclick: async () => {
          const files = await api.pickFiles();
          if (!files || files.length === 0) return;
          verifyPath.value = files[0].path;
          verifyLabel.textContent = files[0].name;
          verifyLabel.classList.remove('empty');
        },
      });

      const verifyBtn = h('button', {
        class: 'btn', type: 'button', text: 'Verify',
        onclick: async () => {
          if (!verifyPath.value) {
            api.toast('Choose a file to verify', 'error');
            return;
          }
          const res = await api.invoke('verify', { path: verifyPath.value, algo: state.algo, expected: expectedInput.value });
          clear(verifyOut);
          if (!res.ok) {
            verifyOut.appendChild(statusNote(res.error, 'error'));
            return;
          }
          verifyOut.appendChild(statusNote(
            res.data.match ? 'Checksum matches.' : `Checksum does NOT match. Actual: ${res.data.actual}`,
            res.data.match ? 'ok' : 'error'
          ));
        },
      });

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'File Hash Generator' }),
        h('p', { class: 'tool-desc', text: 'Generate MD5, SHA-1, SHA-256 and SHA-512 checksums, or verify a file against a known hash.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field' }, [h('label', { class: 'field-label', text: 'Algorithm' }), algoSelect]),
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Files' }),
            h('div', { class: 'field-row' }, [pick, fileLabel]),
          ]),
        ]),
        h('div', { class: 'controls-actions' }, [runBtn]),
      ]));
      container.appendChild(results);
      container.appendChild(h('div', { class: 'group' }, [
        h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Verify a checksum' })]),
        h('div', { class: 'group-body' }, [
          h('div', { class: 'field-row' }, [verifyPick, verifyLabel]),
          expectedInput,
          verifyBtn,
          verifyOut,
        ]),
      ]));
      return container;
    },
  });

  function fileSelectionTool(config) {
    return {
      render(api) {
        const container = h('div', { class: 'tool' });
        const state = { folder: '', recursive: false, selected: new Set(), files: [] };
        const results = h('div', { class: 'results' });
        const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });

        const load = async () => {
          if (!state.folder) return;
          clear(results);
          results.appendChild(h('div', { class: 'run-status', text: 'Reading files…' }));
          const res = await api.invoke('list', { folder: state.folder, recursive: state.recursive });
          clear(results);
          if (!res.ok) {
            results.appendChild(statusNote(res.error, 'error'));
            return;
          }
          state.files = res.data.files;
          state.selected = new Set();
          results.appendChild(config.renderList(res.data, state, api, load));
        };

        const pick = h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Choose folder…',
          onclick: async () => {
            const chosen = await api.pickFolder(config.title);
            if (!chosen) return;
            state.folder = chosen;
            folderLabel.textContent = chosen;
            folderLabel.classList.remove('empty');
            load();
          },
        });

        const recursiveBox = h('label', { class: 'field field-inline' }, [
          h('input', {
            type: 'checkbox',
            onchange: e => {
              state.recursive = e.target.checked;
              load();
            },
          }),
          h('span', { text: 'Include subfolders' }),
        ]);

        container.appendChild(h('div', { class: 'tool-head' }, [
          h('h1', { class: 'tool-title', text: config.title }),
          h('p', { class: 'tool-desc', text: config.description }),
        ]));
        container.appendChild(h('div', { class: 'controls' }, [
          h('div', { class: 'controls-fields' }, [
            h('div', { class: 'field field-wide' }, [
              h('label', { class: 'field-label', text: 'Folder' }),
              h('div', { class: 'field-row' }, [pick, folderLabel]),
            ]),
            recursiveBox,
          ]),
        ]));
        container.appendChild(results);
        results.appendChild(empty('Choose a folder to begin.'));
        return container;
      },
    };
  }

  function selectionHeader(state, rerender) {
    const label = h('span', { class: 'picker-count' });
    const update = () => {
      label.textContent = `${state.selected.size} of ${state.files.length} selected`;
    };
    const all = h('button', {
      class: 'btn btn-sm', type: 'button', text: 'Select all',
      onclick: () => {
        for (const f of state.files) state.selected.add(f.path);
        rerender();
      },
    });
    const none = h('button', {
      class: 'btn btn-sm', type: 'button', text: 'Clear',
      onclick: () => {
        state.selected.clear();
        rerender();
      },
    });
    update();
    return { node: h('div', { class: 'action-row' }, [all, none, label]), update };
  }

  Hub.registerView('attributes', fileSelectionTool({
    title: 'File Attribute Editor',
    description: 'Bulk set hidden, read-only, system and archive attributes.',
    renderList(data, state, api, reload) {
      const wrap = h('div');
      const supported = data.supported;
      const changes = {};

      const redraw = () => {
        clear(wrap);
        build();
      };

      const build = () => {
        const header = selectionHeader(state, redraw);
        wrap.appendChild(header.node);

        if (!supported.hidden) {
          wrap.appendChild(statusNote('Only the read-only attribute can be changed on this platform.', 'info'));
        }

        const toggles = h('div', { class: 'attr-toggles' }, ['readonly', 'hidden', 'system', 'archive'].map(key => {
          const sel = h('select', {
            class: 'input',
            disabled: !supported[key],
            onchange: e => {
              const v = e.target.value;
              if (v === 'keep') delete changes[key];
              else changes[key] = v === 'on';
            },
          }, [
            h('option', { value: 'keep', text: 'Leave unchanged' }),
            h('option', { value: 'on', text: 'Set' }),
            h('option', { value: 'off', text: 'Clear' }),
          ]);
          return h('div', { class: 'field' }, [
            h('label', { class: 'field-label', text: key }),
            sel,
          ]);
        }));
        wrap.appendChild(toggles);

        const applyBtn = h('button', {
          class: 'btn btn-accent', type: 'button', text: 'Apply to selected',
          onclick: async () => {
            if (state.selected.size === 0) {
              api.toast('Select at least one file', 'error');
              return;
            }
            if (Object.keys(changes).length === 0) {
              api.toast('Choose at least one attribute change', 'error');
              return;
            }
            applyBtn.disabled = true;
            const res = await api.invoke('apply', { root: state.folder, paths: Array.from(state.selected), changes });
            applyBtn.disabled = false;
            if (!res.ok) {
              api.toast(res.error, 'error');
              return;
            }
            api.toast(`Updated ${res.data.updated} file(s)`, 'ok');
            reload();
          },
        });
        wrap.appendChild(h('div', { class: 'action-row' }, [applyBtn]));

        if (data.files.length === 0) {
          wrap.appendChild(empty('No files in this folder.'));
          return;
        }

        const rows = data.files.map(f => {
          const box = h('input', {
            type: 'checkbox',
            checked: state.selected.has(f.path),
            onchange: e => {
              if (e.target.checked) state.selected.add(f.path);
              else state.selected.delete(f.path);
              header.update();
            },
          });
          const flags = ['readonly', 'hidden', 'system', 'archive']
            .filter(k => f.attrs[k])
            .map(k => h('span', { class: 'tag', text: k }));
          return h('div', { class: 'tbl-row' }, [
            box,
            h('span', { class: 'mono ellipsis', text: f.name, title: f.path }),
            h('span', { class: 'mono', text: fmtBytes(f.size) }),
            h('span', { class: 'tag-row' }, flags.length > 0 ? flags : [h('span', { class: 'muted', text: 'none' })]),
          ]);
        });
        wrap.appendChild(table([
          { label: '', width: '32px' },
          { label: 'File', width: 'minmax(0,1.6fr)' },
          { label: 'Size', width: '100px' },
          { label: 'Attributes', width: 'minmax(0,1.2fr)' },
        ], rows));
        if (data.truncated) wrap.appendChild(statusNote('Folder hit the file limit; results are partial.', 'warn'));
      };

      build();
      return wrap;
    },
  }));

  Hub.registerView('file-dates', fileSelectionTool({
    title: 'File Date Editor',
    description: 'Bulk change created, modified and accessed timestamps.',
    renderList(data, state, api, reload) {
      const wrap = h('div');
      const dates = { created: '', modified: '', accessed: '' };

      const redraw = () => {
        clear(wrap);
        build();
      };

      const build = () => {
        const header = selectionHeader(state, redraw);
        wrap.appendChild(header.node);

        const inputs = h('div', { class: 'controls-fields' }, ['created', 'modified', 'accessed'].map(key => {
          const input = h('input', {
            class: 'input',
            type: 'datetime-local',
            disabled: key === 'created' && api.platform !== 'win32',
            oninput: e => { dates[key] = e.target.value; },
          });
          return h('div', { class: 'field' }, [
            h('label', { class: 'field-label', text: key }),
            input,
            key === 'created' && api.platform !== 'win32'
              ? h('span', { class: 'field-hint', text: 'Windows only' })
              : null,
          ]);
        }));
        wrap.appendChild(inputs);

        const applyBtn = h('button', {
          class: 'btn btn-accent', type: 'button', text: 'Apply to selected',
          onclick: async () => {
            if (state.selected.size === 0) {
              api.toast('Select at least one file', 'error');
              return;
            }
            const payload = { root: state.folder, paths: Array.from(state.selected) };
            for (const key of ['created', 'modified', 'accessed']) {
              if (dates[key]) payload[key] = new Date(dates[key]).toISOString();
            }
            if (!payload.created && !payload.modified && !payload.accessed) {
              api.toast('Set at least one date', 'error');
              return;
            }
            applyBtn.disabled = true;
            const res = await api.invoke('apply', payload);
            applyBtn.disabled = false;
            if (!res.ok) {
              api.toast(res.error, 'error');
              return;
            }
            api.toast(`Updated ${res.data.updated} file(s)`, 'ok');
            reload();
          },
        });
        wrap.appendChild(h('div', { class: 'action-row' }, [applyBtn]));

        if (data.files.length === 0) {
          wrap.appendChild(empty('No files in this folder.'));
          return;
        }

        const rows = data.files.map(f => {
          const box = h('input', {
            type: 'checkbox',
            checked: state.selected.has(f.path),
            onchange: e => {
              if (e.target.checked) state.selected.add(f.path);
              else state.selected.delete(f.path);
              header.update();
            },
          });
          return h('div', { class: 'tbl-row' }, [
            box,
            h('span', { class: 'mono ellipsis', text: f.name, title: f.path }),
            h('span', { class: 'muted', text: fmtDate(f.created) }),
            h('span', { class: 'muted', text: fmtDate(f.modified) }),
            h('span', { class: 'muted', text: fmtDate(f.accessed) }),
          ]);
        });
        wrap.appendChild(table([
          { label: '', width: '32px' },
          { label: 'File', width: 'minmax(0,1.4fr)' },
          { label: 'Created', width: '150px' },
          { label: 'Modified', width: '150px' },
          { label: 'Accessed', width: '150px' },
        ], rows));
        if (data.truncated) wrap.appendChild(statusNote('Folder hit the file limit; results are partial.', 'warn'));
      };

      build();
      return wrap;
    },
  }));
})();
