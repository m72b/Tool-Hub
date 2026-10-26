const { execFileSync } = require('child_process');
const path = require('path');
const files = ['backend-1', 'backend-2', 'backend-3', 'backend-4', 'backend-5', 'backend-6'];
for (const f of files) {
  execFileSync(process.execPath, [path.join(__dirname, `${f}.test.js`)], { stdio: 'inherit' });
}
