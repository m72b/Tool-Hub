// Font Manager screen.
(function () {
  const { h, clear, statusNote, fmtBytes, fmtNumber, empty } = window.UI;
  const SAMPLE = 'The quick brown fox jumps over the lazy dog 0123456789';
  const MAX_COMPARE = 6;
  const loadedFaces = new Map();
  let counter = 0;

  function bytes(base64) {
    const text = atob(base64);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }

  window.Hub.registerView('font-manager', {
    render(api) {
      const view = { fonts: [], families: [], tab: 'browse', filter: 'all', query: '', selected: null, compare: new Set(), text: SAMPLE, size: 32 };
      const status = h('div');
      const tabs = h('div', { class: 'fm-tabs' });
      const main = h('div', { class: 'fm-main' });
      const textInput = h('input', { class: 'input', type: 'text', value: SAMPLE, spellcheck: 'false', oninput: e => { view.text = e.target.value || SAMPLE; applySamples(); } });
      const sizeInput = h('input', { type: 'range', min: '10', max: '120', value: '32', oninput: e => { view.size = Number(e.target.value); sizeLabel.textContent = `${view.size} px`; applySamples(); } });
      const sizeLabel = h('span', { class: 'muted fm-size', text: '32 px' });

      function applySamples() {
        for (const node of main.querySelectorAll('.fm-sample:not(.fm-unavailable)')) { node.textContent = view.text; node.style.fontSize = `${view.size}px`; }
      }

      // Fonts are loaded into the window only when shown, because a PC can hold hundreds.
      async function loadFace(font) {
        if (loadedFaces.has(font.path)) return loadedFaces.get(font.path);
        const res = await api.invoke('read', { font: font.path });
        if (!res.ok) return null;
        const name = `fm-face-${++counter}`;
        try {
          const face = new FontFace(name, bytes(res.data.data));
          await face.load();
          document.fonts.add(face);
          loadedFaces.set(font.path, name);
          return name;
        } catch {
          return null;
        }
      }

      function sample(font) {
        const node = h('div', { class: 'fm-sample', text: view.text });
        node.style.fontSize = `${view.size}px`;
        loadFace(font).then(name => { if (name) { node.style.fontFamily = `"${name}"`; return; } node.classList.add('fm-unavailable'); node.style.fontSize = ''; node.textContent = 'This font cannot be previewed here, but apps can still use it.'; });
        return node;
      }

      function buildFamilies() {
        const map = new Map();
        for (const font of view.fonts) {
          for (const face of font.faces) {
            if (!map.has(face.family)) map.set(face.family, { name: face.family, entries: [], user: false, monospace: false });
            const family = map.get(face.family);
            if (!family.entries.some(entry => entry.font === font && entry.face.style === face.style)) family.entries.push({ font, face });
            family.user = family.user || font.scope === 'user';
            family.monospace = family.monospace || face.monospace;
          }
        }
        view.families = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      }

      async function load() {
        clear(status);
        clear(main);
        main.appendChild(h('div', { class: 'muted', text: 'Reading your fonts…' }));
        const res = await api.invoke('list', {});
        if (!res.ok) { clear(main); status.appendChild(statusNote(res.error, 'error')); return; }
        view.fonts = res.data.fonts;
        buildFamilies();
        if (!view.selected) view.selected = view.families[0]?.name || null;
        draw();
      }

      async function install() {
        const files = await api.pickFiles({ filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'otc'] }], title: 'Choose fonts to install' });
        if (!files.length) return;
        const res = await api.invoke('install', { paths: files.map(file => file.path) });
        if (!res.ok) { api.toast(res.error, 'error'); return; }
        for (const item of res.data.failed) api.toast(item.error, 'error');
        if (res.data.installed.length) { api.toast(`Installed ${res.data.installed.length} ${res.data.installed.length === 1 ? 'font' : 'fonts'}`, 'ok'); await load(); }
      }

      async function uninstall(font) {
        if (!window.confirm(`Remove ${font.file}? It goes to the Recycle Bin, and apps can no longer use it.`)) return;
        const res = await api.invoke('uninstall', { font: font.path });
        if (res.ok) { api.toast('Font removed', 'ok'); view.selected = null; loadedFaces.delete(font.path); await load(); } else api.toast(res.error, 'error');
      }

      function details(face, font) {
        const rows = [['Full name', face.fullName], ['Style', face.style], ['PostScript name', face.postscript], ['Version', face.version], ['Weight', face.weight], ['Glyphs', face.glyphs ? fmtNumber(face.glyphs) : ''], ['Outlines', face.outlines], ['Units per em', face.unitsPerEm], ['Monospaced', face.monospace ? 'Yes' : 'No'], ['Embedding', face.embedding], ['Maker', face.manufacturer], ['Vendor code', face.vendor], ['Designer', face.designer], ['Website', face.vendorUrl], ['Copyright', face.copyright], ['License', face.license], ['Description', face.description], ['File', font.path], ['Size', fmtBytes(font.size)], ['Installed for', font.scope === 'user' ? 'This user' : 'The system']];
        return h('div', { class: 'fm-pairs' }, rows.filter(([, value]) => value !== '' && value !== undefined && value !== 0).flatMap(([name, value]) => [h('span', { class: 'muted', text: name }), h('span', { class: 'fm-value', text: String(value) })]));
      }

      function drawDetail(box) {
        clear(box);
        const family = view.families.find(item => item.name === view.selected);
        if (!family) { box.appendChild(empty('Choose a font.')); return; }
        const inCompare = view.compare.has(family.name);
        box.append(
          h('div', { class: 'fm-detail-head' }, [
            h('h2', { class: 'fm-family', text: family.name }),
            h('span', { class: 'muted', text: `${family.entries.length} ${family.entries.length === 1 ? 'style' : 'styles'}` }),
            h('button', { class: 'btn btn-sm', type: 'button', text: inCompare ? 'Remove from compare' : 'Add to compare', onclick: () => {
              if (inCompare) view.compare.delete(family.name);
              else if (view.compare.size >= MAX_COMPARE) { api.toast(`Compare up to ${MAX_COMPARE} fonts`, 'error'); return; }
              else view.compare.add(family.name);
              draw();
            } }),
          ]),
        );
        for (const { font, face } of family.entries) {
          const more = h('div', { hidden: true });
          box.appendChild(h('div', { class: 'fm-face' }, [
            h('div', { class: 'fm-face-head' }, [
              h('strong', { text: face.style }),
              h('span', { class: 'muted ellipsis', text: font.file }),
              h('button', { class: 'mini-btn', type: 'button', text: 'Details', onclick: () => { more.hidden = !more.hidden; if (!more.firstChild) more.appendChild(details(face, font)); } }),
              font.scope === 'user' ? h('button', { class: 'mini-btn mini-danger', type: 'button', text: 'Remove', onclick: () => uninstall(font) }) : null,
            ]),
            sample(font),
            more,
          ]));
        }
      }

      function drawBrowse() {
        const list = h('div', { class: 'fm-list' });
        const detail = h('div', { class: 'fm-detail' });
        const fill = () => {
          clear(list);
          const shown = view.families.filter(family => (view.filter !== 'user' || family.user) && (view.filter !== 'mono' || family.monospace) && (!view.query || family.name.toLowerCase().includes(view.query)));
          list.appendChild(h('div', { class: 'muted fm-count', text: `${fmtNumber(shown.length)} families` }));
          for (const family of shown) list.appendChild(h('button', { class: `fm-item${family.name === view.selected ? ' active' : ''}`, type: 'button', text: family.name, onclick: () => { view.selected = family.name; fill(); drawDetail(detail); } }));
        };
        const search = h('input', { class: 'input', type: 'search', placeholder: 'Search fonts…', value: view.query, spellcheck: 'false', oninput: e => { view.query = e.target.value.toLowerCase(); fill(); } });
        const filter = h('select', { class: 'input', onchange: e => { view.filter = e.target.value; fill(); } }, [['all', 'All fonts'], ['user', 'Installed by me'], ['mono', 'Monospaced']].map(([value, label]) => h('option', { value, text: label, selected: value === view.filter })));
        main.appendChild(h('div', { class: 'fm-browse' }, [h('div', { class: 'fm-side' }, [search, filter, list]), detail]));
        fill();
        drawDetail(detail);
      }

      function drawCompare() {
        const families = [...view.compare].map(name => view.families.find(item => item.name === name)).filter(Boolean);
        if (!families.length) { main.appendChild(empty('Add fonts from Browse with "Add to compare".')); return; }
        for (const family of families) {
          const { font, face } = family.entries.find(entry => /^(regular|normal|roman|book)$/i.test(entry.face.style)) || family.entries[0];
          main.appendChild(h('div', { class: 'fm-face' }, [
            h('div', { class: 'fm-face-head' }, [h('strong', { text: family.name }), h('button', { class: 'mini-btn', type: 'button', text: 'Remove', onclick: () => { view.compare.delete(family.name); draw(); } })]),
            sample(font),
          ]));
        }
        const cell = (family, read) => { const entry = family.entries.find(item => /^(regular|normal|roman|book)$/i.test(item.face.style)) || family.entries[0]; return String(read(entry.face, family) ?? ''); };
        const rows = [['Styles', (face, family) => family.entries.length], ['Glyphs', face => fmtNumber(face.glyphs)], ['Weight', face => face.weight], ['Outlines', face => face.outlines], ['Monospaced', face => (face.monospace ? 'Yes' : 'No')], ['Embedding', face => face.embedding], ['Version', face => face.version], ['Maker', face => face.manufacturer]];
        const table = h('div', { class: 'fm-table' }, [h('span'), ...families.map(family => h('strong', { class: 'ellipsis', text: family.name })), ...rows.flatMap(([name, read]) => [h('span', { class: 'muted', text: name }), ...families.map(family => h('span', { class: 'fm-value', text: cell(family, read) }))])]);
        table.style.gridTemplateColumns = `110px repeat(${families.length}, minmax(0, 1fr))`;
        main.appendChild(table);
      }

      async function drawDuplicates() {
        main.appendChild(h('div', { class: 'muted', text: 'Comparing font files…' }));
        const tab = view.tab;
        const res = await api.invoke('duplicates', {});
        if (view.tab !== tab) return;
        clear(main);
        if (!res.ok) { main.appendChild(statusNote(res.error, 'error')); return; }
        const section = (title, hint, groups) => {
          main.appendChild(h('h3', { class: 'fm-heading', text: `${title} (${fmtNumber(groups.length)})` }));
          main.appendChild(h('p', { class: 'muted fm-hint', text: hint }));
          for (const group of groups) {
            main.appendChild(h('div', { class: 'fm-face' }, group.map(font => h('div', { class: 'fm-face-head' }, [
              h('strong', { class: 'fm-dup-name ellipsis', text: font.faces[0].fullName || font.file }),
              h('span', { class: 'muted ellipsis', text: font.path, title: font.path }),
              h('span', { class: 'muted', text: fmtBytes(font.size) }),
              font.scope === 'user' ? h('button', { class: 'mini-btn mini-danger', type: 'button', text: 'Remove', onclick: async () => { await uninstall(font); view.tab = 'duplicates'; draw(); } }) : null,
            ]))));
          }
        };
        if (!res.data.exact.length && !res.data.named.length) { main.appendChild(empty('No duplicate fonts found.')); return; }
        section('Identical files', 'These files have exactly the same contents.', res.data.exact);
        section('Same font name, different files', 'These may be different versions of one font.', res.data.named);
      }

      function draw() {
        clear(tabs);
        for (const [id, label] of [['browse', 'Browse'], ['compare', `Compare (${view.compare.size})`], ['duplicates', 'Duplicates']]) tabs.appendChild(h('button', { class: `fm-tab${view.tab === id ? ' active' : ''}`, type: 'button', text: label, onclick: () => { view.tab = id; draw(); } }));
        clear(main);
        if (view.tab === 'compare') drawCompare();
        else if (view.tab === 'duplicates') drawDuplicates();
        else drawBrowse();
      }

      load();
      return h('div', { class: 'tool' }, [
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Font Manager' }), h('p', { class: 'tool-desc', text: 'Preview and compare fonts, install or remove them, and find duplicates. Fonts that came with the system stay protected.' })]),
        h('div', { class: 'action-row fm-tools' }, [textInput, sizeInput, sizeLabel, h('button', { class: 'btn btn-accent', type: 'button', text: 'Install fonts', onclick: install })]),
        status, tabs, main,
      ]);
    },
  });
})();
