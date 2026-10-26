const { execFileSync } = require('child_process');
const path = require('path');
const suites = ['safe.test.js', 'walk.test.js', 'store.test.js', 'backend.test.js', 'renderer.test.js', 'render-paths.test.js'];
let failed = 0;
for (const s of suites) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, s)], { stdio: 'inherit' });
  } catch {
    failed++;
    console.error(`SUITE FAILED: ${s}`);
  }
}
console.log(failed === 0 ? '\nALL SUITES PASSED' : `\n${failed} suite(s) failed`);
process.exitCode = failed === 0 ? 0 : 1;
