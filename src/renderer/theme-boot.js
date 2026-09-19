(function () {
  try {
    const s = JSON.parse(localStorage.getItem('toolhub_appearance_v1') || '{}');
    const themes = ['midnight', 'graphite', 'nord', 'vector', 'forest', 'daylight'];
    const shapes = ['soft', 'sharp', 'angular'];
    if (themes.includes(s.theme)) document.documentElement.dataset.theme = s.theme;
    if (shapes.includes(s.shape)) document.documentElement.dataset.shape = s.shape;
  } catch (e) {
    document.documentElement.dataset.theme = 'midnight';
  }
})();
