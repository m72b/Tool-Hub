(function () {
  const { h, clear, fmtBytes, fmtNumber, table, empty, statusNote, stat } = window.UI;
  const Hub = window.Hub;

  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = dataUrl;
    });
  }

  function encode(img, width, height, format, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (format === 'jpg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(MIME[format], quality);
    if (!dataUrl.startsWith(`data:${MIME[format]}`)) throw new Error(`${format.toUpperCase()} encoding is not supported here`);
    return dataUrl;
  }

  function targetName(name, format) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    return `${base}.${format}`;
  }

  function buildImageTool(config) {
    return {
      render(api) {
        const container = h('div', { class: 'tool' });
        const state = {
          folder: '',
          outFolder: '',
          files: [],
          selected: new Set(),
          format: 'webp',
          quality: 0.85,
          mode: 'longest',
          value: 1920,
          overwrite: false,
        };

        const results = h('div', { class: 'results' });
        const folderLabel = h('span', { class: 'path-display empty', text: 'No folder selected' });
        const outLabel = h('span', { class: 'path-display empty', text: 'Same as source folder' });

        const drawList = () => {
          clear(results);
          if (state.files.length === 0) {
            results.appendChild(empty('No images found in that folder.'));
            return;
          }
          const header = h('div', { class: 'action-row' }, [
            h('button', {
              class: 'btn btn-sm', type: 'button', text: 'Select all',
              onclick: () => {
                for (const f of state.files) state.selected.add(f.path);
                drawList();
              },
            }),
            h('button', {
              class: 'btn btn-sm', type: 'button', text: 'Clear',
              onclick: () => {
                state.selected.clear();
                drawList();
              },
            }),
            h('span', { class: 'picker-count', text: `${state.selected.size} of ${state.files.length} selected` }),
          ]);
          const rows = state.files.map(f => {
            const box = h('input', {
              type: 'checkbox',
              checked: state.selected.has(f.path),
              onchange: e => {
                if (e.target.checked) state.selected.add(f.path);
                else state.selected.delete(f.path);
                drawList();
              },
            });
            return h('div', { class: 'tbl-row' }, [
              box,
              h('span', { class: 'mono ellipsis', text: f.name, title: f.path }),
              h('span', { class: 'tag', text: f.ext }),
              h('span', { class: 'mono', text: fmtBytes(f.size) }),
            ]);
          });
          results.appendChild(header);
          results.appendChild(table([
            { label: '', width: '32px' },
            { label: 'Image', width: 'minmax(0,1.8fr)' },
            { label: 'Type', width: '80px' },
            { label: 'Size', width: '100px' },
          ], rows));
        };

        const loadFolder = async folder => {
          const res = await api.invoke('listImages', { folder });
          if (!res.ok) {
            api.toast(res.error, 'error');
            return;
          }
          state.folder = res.data.folder;
          state.files = res.data.files;
          state.selected = new Set(res.data.files.map(f => f.path));
          drawList();
        };

        const pick = h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Choose folder…',
          onclick: async () => {
            const chosen = await api.pickFolder('Folder with images');
            if (!chosen) return;
            folderLabel.textContent = chosen;
            folderLabel.classList.remove('empty');
            loadFolder(chosen);
          },
        });

        const pickOut = h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Choose…',
          onclick: async () => {
            const chosen = await api.pickFolder('Output folder');
            if (!chosen) return;
            state.outFolder = chosen;
            outLabel.textContent = chosen;
            outLabel.classList.remove('empty');
          },
        });

        const progress = h('div', { class: 'run-status' });

        const runBtn = h('button', {
          class: 'btn btn-accent', type: 'button', text: config.runLabel,
          onclick: async () => {
            if (state.selected.size === 0) {
              api.toast('Select at least one image', 'error');
              return;
            }
            const outDir = state.outFolder || state.folder;
            runBtn.disabled = true;
            let done = 0;
            let failed = 0;
            let before = 0;
            let after = 0;
            const targets = state.files.filter(f => state.selected.has(f.path));

            for (const file of targets) {
              progress.textContent = `Processing ${done + failed + 1} of ${targets.length}…`;
              try {
                const read = await api.invoke('read', { path: file.path });
                if (!read.ok) throw new Error(read.error);
                const img = await loadImage(read.data.dataUrl);
                const dims = config.dimensions(img, state);
                const dataUrl = encode(img, dims.width, dims.height, state.format, state.quality);
                const name = targetName(file.name, state.format);
                const write = await api.invoke('write', {
                  dir: outDir,
                  name,
                  dataUrl,
                  overwrite: state.overwrite,
                });
                if (!write.ok) throw new Error(write.error);
                before += file.size;
                after += write.data.size;
                done++;
              } catch (err) {
                failed++;
              }
            }

            runBtn.disabled = false;
            progress.textContent = '';
            clear(results);
            results.appendChild(h('div', { class: 'stat-row' }, [
              stat('Processed', fmtNumber(done), 'ok'),
              stat('Failed', fmtNumber(failed), failed > 0 ? 'warn' : null),
              stat('Before', fmtBytes(before)),
              stat('After', fmtBytes(after)),
              stat('Saved', before > after ? fmtBytes(before - after) : '—', 'ok'),
            ]));
            if (failed > 0) {
              results.appendChild(statusNote('Some images failed. They may already exist in the output folder — enable overwrite, or choose a different output folder.', 'warn'));
            }
            results.appendChild(h('button', {
              class: 'btn btn-sm', type: 'button', text: 'Back to list', onclick: drawList,
            }));
            api.toast(`Processed ${done} image(s)`, done > 0 ? 'ok' : 'error');
          },
        });

        const formatSelect = h('select', {
          class: 'input',
          onchange: e => { state.format = e.target.value; },
        }, [
          h('option', { value: 'webp', text: 'WebP', selected: true }),
          h('option', { value: 'png', text: 'PNG' }),
          h('option', { value: 'jpg', text: 'JPEG' }),
        ]);

        const qualityVal = h('span', { class: 'range-val', text: '85%' });
        const quality = h('input', {
          class: 'range', type: 'range', min: '10', max: '100', value: '85',
          oninput: e => {
            state.quality = Number(e.target.value) / 100;
            qualityVal.textContent = `${e.target.value}%`;
          },
        });

        const fields = [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Source folder' }),
            h('div', { class: 'field-row' }, [pick, folderLabel]),
          ]),
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Output folder' }),
            h('div', { class: 'field-row' }, [pickOut, outLabel]),
          ]),
          h('div', { class: 'field' }, [
            h('label', { class: 'field-label', text: 'Output format' }),
            formatSelect,
          ]),
          h('div', { class: 'field' }, [
            h('label', { class: 'field-label', text: 'Quality' }),
            h('div', { class: 'field-row' }, [quality, qualityVal]),
            h('span', { class: 'field-hint', text: 'Applies to WebP and JPEG' }),
          ]),
          ...config.extraFields(state),
          h('label', { class: 'field field-inline' }, [
            h('input', { type: 'checkbox', onchange: e => { state.overwrite = e.target.checked; } }),
            h('span', { text: 'Overwrite existing files' }),
          ]),
        ];

        container.appendChild(h('div', { class: 'tool-head' }, [
          h('h1', { class: 'tool-title', text: config.title }),
          h('p', { class: 'tool-desc', text: config.description }),
        ]));
        container.appendChild(h('div', { class: 'controls' }, [
          h('div', { class: 'controls-fields' }, fields),
          h('div', { class: 'controls-actions' }, [runBtn, progress]),
        ]));
        container.appendChild(results);
        results.appendChild(empty('Choose a folder containing images.'));
        return container;
      },
    };
  }

  Hub.registerView('image-convert', buildImageTool({
    title: 'Image Converter',
    description: 'Batch convert images between PNG, JPEG and WebP at their original size.',
    runLabel: 'Convert selected',
    extraFields: () => [],
    dimensions: img => ({ width: img.naturalWidth, height: img.naturalHeight }),
  }));

  Hub.registerView('image-resize', buildImageTool({
    title: 'Image Resizer',
    description: 'Batch resize and compress images while preserving aspect ratio.',
    runLabel: 'Resize selected',
    extraFields: state => {
      const modeSelect = h('select', {
        class: 'input',
        onchange: e => { state.mode = e.target.value; },
      }, [
        h('option', { value: 'longest', text: 'Fit longest side', selected: true }),
        h('option', { value: 'width', text: 'Set width' }),
        h('option', { value: 'height', text: 'Set height' }),
        h('option', { value: 'percent', text: 'Scale by percent' }),
      ]);
      const valueInput = h('input', {
        class: 'input', type: 'number', min: '1', max: '20000', value: '1920',
        oninput: e => { state.value = Number(e.target.value) || 1; },
      });
      return [
        h('div', { class: 'field' }, [h('label', { class: 'field-label', text: 'Resize mode' }), modeSelect]),
        h('div', { class: 'field' }, [
          h('label', { class: 'field-label', text: 'Value' }),
          valueInput,
          h('span', { class: 'field-hint', text: 'Pixels, or percent when scaling' }),
        ]),
      ];
    },
    dimensions: (img, state) => {
      const w = img.naturalWidth;
      const h2 = img.naturalHeight;
      const v = Math.max(1, Number(state.value) || 1);
      if (state.mode === 'percent') {
        const scale = v / 100;
        return { width: w * scale, height: h2 * scale };
      }
      if (state.mode === 'width') return { width: v, height: (h2 / w) * v };
      if (state.mode === 'height') return { width: (w / h2) * v, height: v };
      const scale = Math.min(1, v / Math.max(w, h2));
      return { width: w * scale, height: h2 * scale };
    },
  }));
})();
