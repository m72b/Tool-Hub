(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('utilities', {
    render(api) {
      const root = h('div', { class: 'tool' });
      const tabs = h('div', { class: 'mode-grid' });
      const body = h('div', { class: 'group-body' });
      let active = 'JSON Formatter';
      const tools = ['JSON Formatter', 'Base64', 'UUID Generator', 'Text Diff', 'Regex Tester', 'Password Generator'];
      const drawTabs = () => { clear(tabs); for (const name of tools) tabs.appendChild(h('button', { class: `settings-mode-btn${name === active ? ' active' : ''}`, type: 'button', text: name, onclick: () => { active = name; drawTabs(); drawBody(); } })); };
      const drawBody = () => {
        clear(body);
        const input = h('textarea', { class: 'input mono', rows: '8', placeholder: active === 'JSON Formatter' ? '{"key":"value"}' : 'Enter text…' });
        const output = h('textarea', { class: 'input mono', rows: '8', readonly: true, placeholder: 'Result' });
        const note = h('div', { class: 'field-hint' });
        const compare = h('textarea', { class: 'input mono', rows: '8', placeholder: 'Second text' });
        const flags = h('input', { class: 'input mono', type: 'text', value: 'gi', placeholder: 'Flags' });
        const source = h('textarea', { class: 'input mono', rows: '4', placeholder: 'Text to test' });
        const run =h('button', { class: 'btn btn-accent', type: 'button', text: 'Run', onclick: () => {
          try {
            if (active === 'JSON Formatter') output.value = JSON.stringify(JSON.parse(input.value), null, 2);
            else if (active === 'Base64') output.value = btoa(unescape(encodeURIComponent(input.value)));
            else if (active === 'UUID Generator') output.value = Array.from({ length: Math.min(Math.max(Number(input.value) || 1, 1), 100) }, () => crypto.randomUUID()).join('\n');
            else if (active === 'Text Diff') output.value = makeTextDiff(input.value, compare.value);
            else if (active === 'Regex Tester') { const re = new RegExp(input.value, flags.value); output.value = [...(source.value.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)))].map(m => `${m[0]} at ${m.index}${m.length > 1 ? ` · groups: ${m.slice(1).join(', ')}` : ''}`).join('\n') || 'No matches'; }
            else if (active === 'Password Generator') output.value = makePassword(Number(input.value) || 20);
            note.textContent = '';
          } catch (err) { output.value = ''; note.textContent = err.message; }
        } });
        if (active === 'Base64') {
          const decode = h('button', { class: 'btn', type: 'button', text: 'Decode Base64', onclick: () => { try { output.value = decodeURIComponent(escape(atob(input.value.trim()))); note.textContent = ''; } catch (err) { note.textContent = 'Input is not valid Base64 text.'; } } });
          body.appendChild(h('div', { class: 'action-row' }, [run, decode]));
        } else if (active === 'Text Diff') {
          body.appendChild(input); body.appendChild(compare); body.appendChild(h('div', { class: 'action-row' }, [run]));
        } else if (active === 'Regex Tester') {
          body.appendChild(input); body.appendChild(flags); body.appendChild(source); body.appendChild(h('div', { class: 'action-row' }, [run]));
        } else {
          if (active === 'UUID Generator') input.value = '1';
          if (active === 'Password Generator') input.value = '20';
          body.appendChild(input); body.appendChild(h('div', { class: 'action-row' }, [run]));
        }
        body.appendChild(note); body.appendChild(output);
        body.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy result', onclick: async () => { if (!output.value) return; await navigator.clipboard.writeText(output.value); api.toast('Copied', 'ok'); } })]));
      };
      root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Text & Data Utilities' }), h('p', { class: 'tool-desc', text: 'Local-only JSON, Base64, UUID, diff, regex and password tools.' })]));
      root.appendChild(tabs); root.appendChild(h('div', { class: 'group' }, [body]));
      drawTabs(); drawBody();
      return root;
    },
  });

  function makeTextDiff(a, b) {
    const left = a.split(/\r?\n/), right = b.split(/\r?\n/);
    if (left.length > 500 || right.length > 500) throw new Error('Diff is limited to 500 lines per side.');
    const dp = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const lines = []; let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { lines.push(`  ${left[i++]}`); j++; }
      else if (j < right.length && (i === left.length || dp[i][j + 1] >= dp[i + 1][j])) lines.push(`+ ${right[j++]}`);
      else lines.push(`- ${left[i++]}`);
    }
    return lines.join('\n');
  }

  function makePassword(length) {
    const size = Math.min(Math.max(Number.isFinite(length) ? length : 20, 8), 128);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
    const bytes = new Uint32Array(size); crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => chars[byte % chars.length]).join('');
  }
})();
