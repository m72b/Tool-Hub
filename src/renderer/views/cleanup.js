(function () {
  const { h, clear, fmtBytes, fmtDate, fmtNumber, table, empty, statusNote, stat, bar, toolShell } = window.UI;
  const Hub = window.Hub;

  const SIZES = [
    { label: 'Any size', value: 0 },
    { label: '1 MB', value: 1048576 },
    { label: '10 MB', value: 10485760 },
    { label: '100 MB', value: 104857600 },
    { label: '500 MB', value: 524288000 },
    { label: '1 GB', value: 1073741824 },
  ];

  Hub.registerView('duplicates', {
    render(api) {
      return toolShell({
        title: 'Duplicate Finder',
        description: 'Find duplicate files by content hash, size or name. Removed files go to the Recycle Bin.',
        action: 'scan',
        runLabel: 'Scan for duplicates',
        busyLabel: 'Hashing files…',
        defaults: { root: '', matchBy: 'hash', minSize: 1, recursive: true },
        fields: [
          { type: 'folder', key: 'root', label: 'Folder to scan', wide: true },
          {
            type: 'select', key: 'matchBy', label: 'Match by', options: [
              { label: 'File contents (hash)', value: 'hash' },
              { label: 'Name and size', value: 'name-size' },
              { label: 'File name', value: 'name' },
              { label: 'File size', value: 'size' },
            ],
          },
          { type: 'select', key: 'minSize', label: 'Minimum size', numeric: true, options: SIZES },
          { type: 'checkbox', key: 'recursive', label: 'Include subfolders' },
        ],
        validate: s => (!s.root ? 'Choose a folder to scan' : null),
        params: s => ({ roots: [s.root], matchBy: s.matchBy, minSize: s.minSize, recursive: s.recursive }),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [
            stat('Duplicate groups', fmtNumber(data.totalGroups)),
            stat('Files scanned', fmtNumber(data.scanned)),
            stat('Reclaimable', fmtBytes(data.wasted), 'warn'),
          ]));
          if (data.truncated) wrap.appendChild(statusNote('Scan hit the file limit; results are partial.', 'warn'));
          if (data.groups.length === 0) {
            wrap.appendChild(empty('No duplicates found.'));
            return wrap;
          }

          const selected = new Set();
          for (const group of data.groups) {
            for (const file of group.files.slice(1)) selected.add(file.path);
          }

          const countLabel = h('span', { class: 'picker-count' });
          const updateCount = () => {
            countLabel.textContent = `${selected.size} file(s) selected`;
          };

          const removeBtn = h('button', {
            class: 'btn btn-danger', type: 'button', text: 'Move selected to Recycle Bin',
            onclick: async () => {
              if (selected.size === 0) {
                api.toast('Nothing selected', 'error');
                return;
              }
              removeBtn.disabled = true;
              removeBtn.textContent = 'Removing…';
              const res = await api.invoke('remove', { roots: [ctx.state.root], paths: Array.from(selected) });
              removeBtn.disabled = false;
              removeBtn.textContent = 'Move selected to Recycle Bin';
              if (!res.ok) {
                api.toast(res.error, 'error');
                return;
              }
              api.toast(`Removed ${res.data.removed} file(s)`, 'ok');
              ctx.rerun();
            },
          });

          wrap.appendChild(h('div', { class: 'action-row' }, [removeBtn, countLabel]));

          const groups = h('div', { class: 'group-list' });
          for (const group of data.groups) {
            const files = group.files.map((file, index) => {
              const box = h('input', {
                type: 'checkbox',
                checked: selected.has(file.path),
                onchange: e => {
                  if (e.target.checked) selected.add(file.path);
                  else selected.delete(file.path);
                  updateCount();
                },
              });
              return h('div', { class: 'dupe-file' }, [
                box,
                h('span', { class: 'dupe-name', text: file.name, title: file.path }),
                h('span', { class: 'dupe-dir', text: file.dir, title: file.dir }),
                h('span', { class: 'dupe-date', text: fmtDate(file.mtime) }),
                index === 0 ? h('span', { class: 'tag tag-core', text: 'oldest' }) : null,
                h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(file.path) }),
              ]);
            });
            groups.appendChild(h('div', { class: 'group' }, [
              h('div', { class: 'group-head' }, [
                h('span', { class: 'group-title', text: `${group.count} copies · ${fmtBytes(group.size)} each` }),
                h('span', { class: 'group-sub', text: `${fmtBytes(group.size * (group.count - 1))} reclaimable` }),
              ]),
              h('div', { class: 'group-body' }, files),
            ]));
          }
          updateCount();
          wrap.appendChild(groups);
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('large-files', {
    render(api) {
      return toolShell({
        title: 'Large File Finder',
        description: 'Locate the biggest files in a folder or drive.',
        action: 'scan',
        runLabel: 'Find large files',
        busyLabel: 'Scanning…',
        defaults: { root: '', minSize: 104857600, limit: 200, recursive: true },
        fields: [
          { type: 'folder', key: 'root', label: 'Folder to scan', wide: true },
          { type: 'select', key: 'minSize', label: 'Minimum size', numeric: true, options: SIZES.slice(1) },
          { type: 'select', key: 'limit', label: 'Show at most', numeric: true, options: [
            { label: '50 files', value: 50 },
            { label: '200 files', value: 200 },
            { label: '1000 files', value: 1000 },
          ] },
          { type: 'checkbox', key: 'recursive', label: 'Include subfolders' },
        ],
        validate: s => (!s.root ? 'Choose a folder to scan' : null),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [
            stat('Matches', fmtNumber(data.total)),
            stat('Combined size', fmtBytes(data.totalSize)),
            stat('Files scanned', fmtNumber(data.scanned)),
          ]));
          if (data.truncated) wrap.appendChild(statusNote('Scan hit the file limit; results are partial.', 'warn'));
          if (data.files.length === 0) {
            wrap.appendChild(empty('No files matched that size.'));
            return wrap;
          }
          const cols = [
            { label: 'Name', width: 'minmax(0,1.4fr)' },
            { label: 'Folder', width: 'minmax(0,1.6fr)' },
            { label: 'Size', width: '100px' },
            { label: 'Modified', width: '140px' },
            { label: '', width: '76px' },
          ];
          const rows = data.files.map(f => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'mono ellipsis', text: f.name, title: f.name }),
            h('span', { class: 'muted ellipsis', text: f.dir, title: f.dir }),
            h('span', { class: 'mono', text: fmtBytes(f.size) }),
            h('span', { class: 'muted', text: fmtDate(f.mtime) }),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(f.path) }),
          ]));
          wrap.appendChild(table(cols, rows));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('disk-analyzer', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const state = { root: '' };

      const head = h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'Disk Space Analyzer' }),
        h('p', { class: 'tool-desc', text: 'See which folders are consuming your storage. Click a folder to drill in.' }),
      ]);

      const pathBar = h('div', { class: 'path-bar' });
      const results = h('div', { class: 'results' });

      const load = async root => {
        clear(results);
        results.appendChild(h('div', { class: 'run-status', text: 'Measuring folder sizes…' }));
        const res = await api.invoke('scan', { root });
        clear(results);
        if (!res.ok) {
          results.appendChild(statusNote(res.error, 'error'));
          return;
        }
        const data = res.data;
        state.root = data.root;

        clear(pathBar);
        pathBar.appendChild(h('span', { class: 'mono ellipsis', text: data.root, title: data.root }));
        if (data.parent) {
          pathBar.appendChild(h('button', { class: 'btn btn-sm', type: 'button', text: 'Up', onclick: () => load(data.parent) }));
        }

        results.appendChild(h('div', { class: 'stat-row' }, [
          stat('Total', fmtBytes(data.total)),
          stat('Files here', fmtNumber(data.fileCount)),
          stat('Entries', fmtNumber(data.children.length)),
        ]));

        if (data.children.length === 0) {
          results.appendChild(empty('This folder is empty.'));
          return;
        }

        const rows = data.children.map(child => {
          const name = child.isDir
            ? h('button', { class: 'link-btn ellipsis', type: 'button', text: child.name, title: child.path, onclick: () => load(child.path) })
            : h('span', { class: 'mono ellipsis', text: child.name, title: child.path });
          return h('div', { class: 'tbl-row' }, [
            h('span', { class: 'type-cell', text: child.isDir ? 'DIR' : 'FILE' }),
            name,
            h('span', { class: 'mono', text: fmtBytes(child.size) }),
            h('span', { class: 'bar-cell' }, [bar(child.percent), h('span', { class: 'pct', text: `${child.percent}%` })]),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(child.path) }),
          ]);
        });
        results.appendChild(table([
          { label: 'Type', width: '56px' },
          { label: 'Name', width: 'minmax(0,1.6fr)' },
          { label: 'Size', width: '100px' },
          { label: 'Share', width: 'minmax(140px,1fr)' },
          { label: '', width: '76px' },
        ], rows));
      };

      const pick = h('button', {
        class: 'btn btn-accent', type: 'button', text: 'Choose folder',
        onclick: async () => {
          const chosen = await api.pickFolder('Folder to analyze');
          if (chosen) load(chosen);
        },
      });

      container.appendChild(head);
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [pathBar]),
        h('div', { class: 'controls-actions' }, [pick]),
      ]));
      container.appendChild(results);
      results.appendChild(empty('Choose a folder to begin.'));
      return container;
    },
  });

  Hub.registerView('temp-cleaner', {
    render(api) {
      return toolShell({
        title: 'Temporary File Cleaner',
        description: 'Preview and clear temp, cache and prefetch locations. Items go to the Recycle Bin unless you choose otherwise.',
        action: 'scan',
        runLabel: 'Scan temp locations',
        busyLabel: 'Measuring…',
        autoRun: true,
        defaults: {},
        fields: [],
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [
            stat('Reclaimable', fmtBytes(data.totalSize), 'warn'),
            stat('Files', fmtNumber(data.totalCount)),
          ]));

          const selected = new Set();
          const permanent = { value: false };

          const rows = data.targets.map(target => {
            const box = h('input', {
              type: 'checkbox',
              checked: selected.has(target.id),
              disabled: !target.available,
              onchange: e => {
                if (e.target.checked) selected.add(target.id);
                else selected.delete(target.id);
              },
            });
            return h('div', { class: 'tbl-row' }, [
              box,
              h('span', { class: 'ellipsis' }, [
                h('span', { text: target.label }),
                h('span', { class: 'sub-line', text: target.description }),
              ]),
              h('span', { class: 'mono muted ellipsis', text: target.path, title: target.path }),
              h('span', { class: 'mono', text: target.available ? fmtBytes(target.size) : 'n/a' }),
              h('span', { class: 'muted', text: target.available ? fmtNumber(target.count) : '—' }),
            ]);
          });

          const cleanBtn = h('button', {
            class: 'btn btn-danger', type: 'button', text: 'Clean selected',
            onclick: async () => {
              if (selected.size === 0) {
                api.toast('Nothing selected', 'error');
                return;
              }
              if (!window.confirm(`Clean the contents of ${selected.size} selected location(s)?`)) return;
              if (permanent.value && !window.confirm('Permanently delete the selected contents? This cannot be undone.')) return;
              cleanBtn.disabled = true;
              cleanBtn.textContent = 'Cleaning…';
              const res = await api.invoke('clean', { ids: Array.from(selected), permanent: permanent.value });
              cleanBtn.disabled = false;
              cleanBtn.textContent = 'Clean selected';
              if (!res.ok) {
                api.toast(res.error, 'error');
                return;
              }
              api.toast(permanent.value
                ? `Permanently deleted ${res.data.removed} item(s), freeing up to ${fmtBytes(res.data.freed)}`
                : `Moved ${res.data.removed} item(s) to the Recycle Bin`, 'ok');
              if (res.data.skippedCount > 0) {
                api.toast(`${res.data.skippedCount} item(s) were in use and skipped`, 'info');
              }
              ctx.rerun();
            },
          });

          const permBox = h('label', { class: 'field field-inline' }, [
            h('input', { type: 'checkbox', onchange: e => { permanent.value = e.target.checked; } }),
            h('span', { text: 'Delete permanently (skip Recycle Bin)' }),
          ]);

          wrap.appendChild(h('div', { class: 'action-row' }, [cleanBtn, permBox]));
          wrap.appendChild(table([
            { label: '', width: '32px' },
            { label: 'Location', width: 'minmax(0,1.1fr)' },
            { label: 'Path', width: 'minmax(0,1.6fr)' },
            { label: 'Size', width: '100px' },
            { label: 'Files', width: '90px' },
          ], rows));
          wrap.appendChild(statusNote('Files currently in use by Windows cannot be removed and are skipped automatically.', 'info'));
          return wrap;
        },
      }, api);
    },
  });
})();
