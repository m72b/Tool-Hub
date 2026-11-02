// Tool Library section for installing signed add-ons and managing trusted signing keys.
(function () {
  const { h, clear, statusNote } = window.UI;

  function confirmInstall(picked, toast) {
    const { info } = picked;
    const bg = h('div', { class: 'modal-bg open' });
    const close = () => bg.remove();
    const installBtn = h('button', { class: 'btn btn-accent', type: 'button', text: info.replaces ? `Update to ${info.manifest.version}` : 'Install add-on', disabled: !!info.problem, onclick: async () => {
      installBtn.disabled = true;
      installBtn.textContent = 'Installing…';
      const result = await window.hub.addons.install(picked.token);
      if (!result.ok) { toast(result.error, 'error'); installBtn.disabled = false; installBtn.textContent = 'Install add-on'; return; }
      clear(box);
      box.appendChild(h('div', { class: 'modal-title', text: `${info.manifest.name} installed` }));
      box.appendChild(h('p', { class: 'tool-desc', text: 'Tool Hub is restarting to load it…' }));
    } });
    const box = h('div', { class: 'modal-box' }, [
      h('div', { class: 'modal-title', text: `Install ${info.manifest.name}?` }),
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Version' }), h('span', { class: 'kv-value', text: info.replaces ? `${info.manifest.version} (replaces ${info.replaces})` : info.manifest.version })]),
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Signed by' }), h('span', { class: 'kv-value', text: info.signer })]),
      info.authorizer ? h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Authorized by' }), h('span', { class: 'kv-value', text: info.authorizer })]) : null,
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Adds' }), h('span', { class: 'kv-value', text: info.manifest.tools.map(tool => tool.name).join(', ') })]),
      info.manifest.description ? h('p', { class: 'tool-desc', text: info.manifest.description }) : null,
      info.builtIn ? null : statusNote('This add-on is signed with a personal key you trusted, not the official Tool Hub key. It can read and change your files like any other tool.', 'warn'),
      info.problem ? statusNote(`Cannot install: this add-on ${info.problem}.`, 'error') : null,
      statusNote('Tool Hub restarts after installing.', 'info'),
      h('div', { class: 'action-row' }, [installBtn, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close })]),
    ]);
    bg.appendChild(box);
    bg.addEventListener('mousedown', event => { if (event.target === bg) close(); });
    document.body.appendChild(bg);
  }

  function render(toast) {
    const wrap = h('div', { class: 'picker-group' });
    const draw = async () => {
      const data = await window.hub.addons.list();
      clear(wrap);
      wrap.appendChild(h('div', { class: 'picker-group-label', text: 'Add-ons' }));

      const addBtn = h('button', { class: 'btn btn-accent btn-sm', type: 'button', text: 'Add add-on…', onclick: async () => {
        const picked = await window.hub.addons.pick();
        if (!picked) return;
        if (!picked.ok) { toast(picked.error, 'error'); return; }
        confirmInstall(picked, toast);
      } });
      wrap.appendChild(h('div', { class: 'action-row' }, [addBtn, h('span', { class: 'field-hint', text: 'Add-ons are .thaddon files. Only signed add-ons from trusted keys can be installed.' })]));

      if (!data.addons.length) wrap.appendChild(h('div', { class: 'empty-state', text: 'No add-ons installed. Download one (for example the PDF Tools add-on from the Tool Hub GitHub releases) and add it here.' }));
      else wrap.appendChild(h('div', { class: 'tool-grid' }, data.addons.map(addon => h('div', { class: 'tool-card selected' }, [
        h('div', { class: 'tool-card-top' }, [h('span', { class: 'tool-card-icon', text: 'ADD' }), h('span', { class: 'tool-card-name', text: addon.name }), h('span', { class: 'tag', text: `v${addon.version}` })]),
        h('p', { class: 'tool-card-desc', text: addon.description || addon.tools.map(tool => tool.name).join(', ') }),
        addon.problem ? statusNote(`Disabled: ${addon.problem}.`, 'warn') : null,
        h('div', { class: 'tool-card-tags' }, [
          h('span', { class: 'tag', text: `Signed by ${addon.signer}` }),
          addon.authorizer ? h('span', { class: 'tag tag-ok', text: `Authorized by ${addon.authorizer}` }) : null,
          h('button', { class: 'mini-btn mini-danger', type: 'button', text: 'Remove', onclick: async () => {
            if (!window.confirm(`Remove ${addon.name}? Its tools disappear and Tool Hub restarts. Your files are not affected.`)) return;
            const result = await window.hub.addons.remove(addon.id);
            if (!result.ok) toast(result.error, 'error'); else toast('Add-on removed; restarting…', 'ok');
          } }),
        ]),
      ]))));

      const keyName = h('input', { class: 'input', type: 'text', placeholder: 'Who is this key from?' });
      const keyValue = h('textarea', { class: 'input mono', rows: '2', spellcheck: 'false', placeholder: 'Paste the public key (base64 or PEM)' });
      const keysBody = h('div', { class: 'group-body' }, [
        ...data.keys.map(key => h('div', { class: 'key-row' }, [
          h('span', { class: 'key-name', text: key.name }),
          h('span', { class: 'mono muted', text: key.keyId, title: 'Key fingerprint' }),
          key.builtIn ? h('span', { class: 'tag tag-core', text: 'Built in' }) : h('button', { class: 'mini-btn mini-danger', type: 'button', text: 'Remove', onclick: async () => {
            if (!window.confirm(`Stop trusting "${key.name}"? Add-ons already installed stay installed.`)) return;
            const result = await window.hub.addons.untrustKey(key.keyId);
            if (!result.ok) toast(result.error, 'error'); else draw();
          } }),
        ])),
        statusNote('Only trust keys from people you know. A trusted key can sign add-ons that run with full access to your files.', 'warn'),
        keyName, keyValue,
        h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Trust this key', onclick: async () => {
          const result = await window.hub.addons.trustKey(keyName.value, keyValue.value);
          if (!result.ok) { toast(result.error, 'error'); return; }
          toast('Key trusted', 'ok');
          draw();
        } })]),
      ]);
      wrap.appendChild(h('details', { class: 'group more-options-card' }, [h('summary', { class: 'group-head' }, [h('span', { class: 'group-title', text: `Trusted keys (${data.keys.length})` })]), keysBody]));
    };
    draw();
    return wrap;
  }

  window.AddonManagerUI = { render };
})();
