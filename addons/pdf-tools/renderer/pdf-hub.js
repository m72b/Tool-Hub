// The PDF Tools hub: category tabs and a card per tool; each card opens that tool in place.
(function () {
  const { h, clear } = window.UI;
  const K = window.PdfKit;
  const TAB_KEY = 'toolhub_pdf_tab_v1';

  window.Hub.registerView('pdf', {
    render(api) {
      const root = h('div', { class: 'tool pdf-hub' });
      let tab = 'all';
      try { tab = localStorage.getItem(TAB_KEY) || 'all'; } catch {}
      if (!K.GROUPS.some(g => g.id === tab)) tab = 'all';
      const search = h('input', { class: 'input pdf-search', type: 'search', placeholder: 'Search PDF tools…', spellcheck: 'false' });
      const tabs = h('div', { class: 'pdf-tabs', role: 'tablist' });
      const grid = h('div', { class: 'pdf-card-grid' });
      const views = new Map();

      const drawTabs = () => {
        clear(tabs);
        for (const group of K.GROUPS) tabs.appendChild(h('button', { class: `pdf-tab${group.id === tab ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(group.id === tab), text: group.label, onclick: () => {
          tab = group.id;
          try { localStorage.setItem(TAB_KEY, tab); } catch {}
          drawTabs(); drawGrid();
        } }));
      };

      const drawGrid = () => {
        clear(grid);
        const query = search.value.trim().toLowerCase();
        const list = K.tools.filter(tool => (tab === 'all' || tool.groups.includes(tab)) && (!query || `${tool.name} ${tool.description}`.toLowerCase().includes(query)));
        if (!list.length) grid.appendChild(h('div', { class: 'empty-state', text: 'No PDF tools match your search.' }));
        for (const tool of list) grid.appendChild(h('button', { class: 'pdf-card', type: 'button', onclick: () => openTool(tool) }, [
          h('span', { class: `pdf-card-icon pdf-g-${tool.groups[0]}`, text: tool.icon }),
          h('span', { class: 'pdf-card-name', text: tool.name }),
          h('span', { class: 'pdf-card-desc', text: tool.description }),
        ]));
      };

      const home = h('div', { class: 'pdf-home' }, [
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'PDF Tools' }), h('p', { class: 'tool-desc', text: 'Everything runs on this computer — your files are never uploaded.' })]),
        h('div', { class: 'pdf-hub-bar' }, [tabs, search]),
        grid,
      ]);
      const toolArea = h('div', { class: 'pdf-tool-area', hidden: true });

      function openTool(tool) {
        if (!views.has(tool.id)) {
          let body;
          try { body = tool.render(api); }
          catch (err) { body = window.UI.statusNote(`This tool could not start: ${err.message}`, 'error'); }
          views.set(tool.id, h('div', { class: 'pdf-tool' }, [
            h('div', { class: 'pdf-tool-head' }, [
              h('button', { class: 'btn btn-sm', type: 'button', text: '← All PDF tools', onclick: showHome }),
              h('span', { class: `pdf-card-icon pdf-g-${tool.groups[0]}`, text: tool.icon }),
              h('div', {}, [h('h1', { class: 'tool-title', text: tool.name }), h('p', { class: 'tool-desc', text: tool.description })]),
            ]),
            body,
          ]));
        }
        clear(toolArea);
        toolArea.appendChild(views.get(tool.id));
        home.hidden = true;
        toolArea.hidden = false;
        root.parentElement?.scrollTo?.(0, 0);
      }

      function showHome() {
        toolArea.hidden = true;
        home.hidden = false;
        drawGrid();
      }

      search.addEventListener('input', drawGrid);
      drawTabs();
      drawGrid();
      root.append(home, toolArea);
      return root;
    },
  });
})();
