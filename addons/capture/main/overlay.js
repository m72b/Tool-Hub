// Region picker. The main process calls window.pickRegion(image) and waits for the result.
window.pickRegion = image => new Promise(resolve => {
  const shot = document.getElementById('shot');
  const dim = document.getElementById('dim');
  const box = document.getElementById('box');
  const size = document.getElementById('size');
  const hint = document.getElementById('hint');
  shot.src = image;
  let start = null;
  let rect = null;

  window.addEventListener('keydown', event => { if (event.key === 'Escape') resolve(null); });
  window.addEventListener('mousedown', event => {
    if (event.button !== 0) { resolve(null); return; }
    start = { x: event.clientX, y: event.clientY };
    dim.style.display = 'none';
    hint.style.display = 'none';
  });
  window.addEventListener('mousemove', event => {
    if (!start) return;
    rect = {
      x: Math.min(start.x, event.clientX),
      y: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
    box.style.display = 'block';
    box.style.left = `${rect.x}px`;
    box.style.top = `${rect.y}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    size.style.display = 'block';
    size.textContent = `${Math.round(rect.width * devicePixelRatio)} × ${Math.round(rect.height * devicePixelRatio)}`;
    size.style.left = `${rect.x}px`;
    size.style.top = `${Math.max(0, rect.y - 24)}px`;
  });
  window.addEventListener('mouseup', () => {
    if (!start) return;
    resolve(rect && rect.width >= 4 && rect.height >= 4 ? rect : null);
  });
});
