// Image editor for captures: shapes, text, highlighting and blur, drawn onto a canvas with undo.
(function () {
  const { h } = window.UI;
  const TOOLS = [['arrow', 'Arrow'], ['rect', 'Box'], ['pen', 'Pen'], ['highlight', 'Highlight'], ['text', 'Text'], ['blur', 'Blur']];
  const BLOCK = 12;

  function drawArrow(g, op) {
    const angle = Math.atan2(op.y2 - op.y1, op.x2 - op.x1);
    const head = Math.max(12, op.width * 4);
    g.beginPath();
    g.moveTo(op.x1, op.y1);
    g.lineTo(op.x2, op.y2);
    g.stroke();
    g.beginPath();
    g.moveTo(op.x2, op.y2);
    g.lineTo(op.x2 - head * Math.cos(angle - 0.45), op.y2 - head * Math.sin(angle - 0.45));
    g.lineTo(op.x2 - head * Math.cos(angle + 0.45), op.y2 - head * Math.sin(angle + 0.45));
    g.closePath();
    g.fill();
  }

  const box = op => ({ x: Math.min(op.x1, op.x2), y: Math.min(op.y1, op.y2), w: Math.abs(op.x2 - op.x1), h: Math.abs(op.y2 - op.y1) });

  // Blur is a coarse mosaic that replaces the pixels, so the original cannot be recovered from a saved image.
  function pixelate(g, canvas, op) {
    const r = box(op);
    if (r.w < 1 || r.h < 1) return;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.ceil(r.w / BLOCK));
    small.height = Math.max(1, Math.ceil(r.h / BLOCK));
    const shrink = small.getContext('2d');
    shrink.imageSmoothingQuality = 'high';
    shrink.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
    g.save();
    g.imageSmoothingEnabled = false;
    g.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
    g.restore();
  }

  function paint(g, canvas, op) {
    g.save();
    g.strokeStyle = g.fillStyle = op.color;
    g.lineWidth = op.width;
    g.lineCap = g.lineJoin = 'round';
    if (op.type === 'arrow') drawArrow(g, op);
    else if (op.type === 'rect') { const r = box(op); g.strokeRect(r.x, r.y, r.w, r.h); }
    else if (op.type === 'highlight') { const r = box(op); g.globalAlpha = 0.35; g.fillRect(r.x, r.y, r.w, r.h); }
    else if (op.type === 'blur') pixelate(g, canvas, op);
    else if (op.type === 'text') { g.font = `${op.width * 6}px system-ui, sans-serif`; g.textBaseline = 'top'; g.fillText(op.text, op.x1, op.y1); }
    else if (op.type === 'pen') {
      g.beginPath();
      op.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    }
    g.restore();
  }

  window.CaptureEditor = function createEditor(imageUrl) {
    const canvas = h('canvas', { class: 'cap-canvas' });
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const image = new Image();
    const state = { tool: 'arrow', color: '#ff3b30', width: 4, ops: [], active: null };

    function redraw() {
      g.drawImage(image, 0, 0);
      for (const op of state.ops) paint(g, canvas, op);
      if (state.active) paint(g, canvas, state.active);
    }

    const point = event => {
      const r = canvas.getBoundingClientRect();
      return [Math.round((event.clientX - r.left) * canvas.width / r.width), Math.round((event.clientY - r.top) * canvas.height / r.height)];
    };

    const textField = h('input', { class: 'input cap-text', type: 'text', placeholder: 'Type, then click the image', hidden: true });
    const buttons = TOOLS.map(([id, label]) => h('button', { class: `cap-tool${id === state.tool ? ' active' : ''}`, type: 'button', text: label, onclick: () => {
      state.tool = id;
      buttons.forEach((button, i) => button.classList.toggle('active', TOOLS[i][0] === id));
      textField.hidden = id !== 'text';
    } }));
    const undo = () => { state.ops.pop(); redraw(); };

    canvas.addEventListener('pointerdown', event => {
      const [x, y] = point(event);
      const base = { type: state.tool, color: state.color, width: state.width };
      if (state.tool === 'text') {
        if (textField.value.trim()) { state.ops.push({ ...base, x1: x, y1: y, text: textField.value }); redraw(); }
        return;
      }
      state.active = state.tool === 'pen' ? { ...base, points: [[x, y]] } : { ...base, x1: x, y1: y, x2: x, y2: y };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!state.active) return;
      const [x, y] = point(event);
      if (state.active.type === 'pen') state.active.points.push([x, y]);
      else { state.active.x2 = x; state.active.y2 = y; }
      redraw();
    });
    const finish = () => {
      if (!state.active) return;
      state.ops.push(state.active);
      state.active = null;
      redraw();
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    const toolbar = h('div', { class: 'cap-toolbar' }, [
      ...buttons,
      textField,
      h('input', { class: 'cap-color', type: 'color', value: state.color, title: 'Color', oninput: e => { state.color = e.target.value; } }),
      h('select', { class: 'input cap-width', title: 'Thickness', onchange: e => { state.width = Number(e.target.value); } }, [[2, 'Thin'], [4, 'Medium'], [8, 'Thick']].map(([value, label]) => h('option', { value: String(value), text: label, selected: value === state.width }))),
      h('button', { class: 'mini-btn', type: 'button', text: 'Undo', onclick: undo }),
    ]);

    const ready = new Promise((resolve, reject) => {
      image.onload = () => { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; redraw(); resolve(); };
      image.onerror = reject;
    });
    image.src = imageUrl;

    return { toolbar, canvas, ready, changed: () => state.ops.length > 0, result: () => canvas.toDataURL('image/png') };
  };
})();
