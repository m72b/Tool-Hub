const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const safe = require('../src/core/safe');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safetest-'));
const inner = path.join(tmp, 'inner');
fs.mkdirSync(inner);
fs.writeFileSync(path.join(inner, 'a.txt'), 'hello');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

check('isInside true for child', () => {
  assert.strictEqual(safe.isInside(tmp, inner), true);
});
check('isInside true for self', () => {
  assert.strictEqual(safe.isInside(tmp, tmp), true);
});
check('isInside false for parent', () => {
  assert.strictEqual(safe.isInside(inner, tmp), false);
});
check('isInside false for traversal', () => {
  assert.strictEqual(safe.isInside(tmp, path.join(tmp, '..', 'elsewhere')), false);
});
check('isInside false for sibling prefix', () => {
  assert.strictEqual(safe.isInside('/a/data', '/a/data-other'), false);
});
check('assertInside blocks traversal', () => {
  assert.throws(() => safe.assertInside(inner, path.join(inner, '..', 'x')), /outside the permitted folder/);
});
check('assertInside allows child', () => {
  assert.doesNotThrow(() => safe.assertInside(tmp, path.join(inner, 'a.txt')));
});
check('normalizeAbsolute rejects null byte', () => {
  assert.throws(() => safe.normalizeAbsolute('/tmp/a\0b'), /null byte/);
});
check('normalizeAbsolute rejects empty', () => {
  assert.throws(() => safe.normalizeAbsolute(''), /required/);
});
check('existingDir rejects file', () => {
  assert.throws(() => safe.existingDir(path.join(inner, 'a.txt')), /not a folder/);
});
check('existingFile rejects dir', () => {
  assert.throws(() => safe.existingFile(inner), /not a file/);
});
check('existingFile rejects missing', () => {
  assert.throws(() => safe.existingFile(path.join(inner, 'nope.txt')), /does not exist/);
});

check('validHost accepts hostname', () => {
  assert.strictEqual(safe.validHost('example.com'), 'example.com');
});
check('validHost accepts ipv4', () => {
  assert.strictEqual(safe.validHost('8.8.8.8'), '8.8.8.8');
});
check('validHost accepts ipv6', () => {
  assert.strictEqual(safe.validHost('2001:4860:4860::8888'), '2001:4860:4860::8888');
});
check('validHost trims', () => {
  assert.strictEqual(safe.validHost('  example.com  '), 'example.com');
});
const injections = [
  'example.com; rm -rf /',
  'example.com && calc.exe',
  'example.com | whoami',
  '$(whoami)',
  '`whoami`',
  'a b',
  '--option',
  'host\nnewline',
  'host&echo',
  '>out.txt',
];
for (const bad of injections) {
  check(`validHost rejects ${JSON.stringify(bad)}`, () => {
    assert.throws(() => safe.validHost(bad), /invalid characters|required/);
  });
}

check('safeEntryName rejects traversal', () => {
  assert.strictEqual(safe.safeEntryName('..'), false);
  assert.strictEqual(safe.safeEntryName('a/b'), false);
  assert.strictEqual(safe.safeEntryName('a\\b'), false);
  assert.strictEqual(safe.safeEntryName('ok.txt'), true);
});

check('parseCommandLine quoted exe', () => {
  const r = safe.parseCommandLine('"C:\\Program Files\\App\\unins.exe" /SILENT');
  assert.strictEqual(r.command, 'C:\\Program Files\\App\\unins.exe');
  assert.deepStrictEqual(r.args, ['/SILENT']);
});
check('parseCommandLine bare exe', () => {
  const r = safe.parseCommandLine('C:\\App\\unins.exe /S /x');
  assert.strictEqual(r.command, 'C:\\App\\unins.exe');
  assert.deepStrictEqual(r.args, ['/S', '/x']);
});
check('parseCommandLine msiexec', () => {
  const r = safe.parseCommandLine('MsiExec.exe /X{ABC-123}');
  assert.strictEqual(r.command, 'MsiExec.exe');
  assert.deepStrictEqual(r.args, ['/X{ABC-123}']);
});
check('parseCommandLine empty', () => {
  assert.strictEqual(safe.parseCommandLine('   '), null);
  assert.strictEqual(safe.parseCommandLine(null), null);
});

check('run rejects non-string args', async () => {
  assert.throws(() => safe.run('echo', [1]), /must be strings/);
});

check('toInt clamps', () => {
  assert.strictEqual(safe.toInt('5', 0, 0, 3), 3);
  assert.strictEqual(safe.toInt('abc', 7), 7);
  assert.strictEqual(safe.toInt('-2', 0, 0, 10), 0);
});

(async () => {
  const res = await safe.run('node', ['-e', 'process.stdout.write("hi")']);
  check('run executes without shell', () => {
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.stdout, 'hi');
  });
  const missing = await safe.run('definitely-not-a-real-binary-xyz', []);
  check('run handles missing binary', () => {
    assert.strictEqual(missing.ok, false);
    assert.strictEqual(missing.code, 'ENOENT');
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`safe.js: ${passed} checks passed`);
})();
