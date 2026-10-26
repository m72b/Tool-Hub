#!/usr/bin/env node
'use strict';

const path = require('path');

const commands = {
  hash: async args => {
    const algoIndex = args.indexOf('--algo');
    const algo = algoIndex >= 0 ? args[algoIndex + 1] : 'sha256';
    const files = args.filter((item, index) => item !== '--algo' && (algoIndex < 0 || index !== algoIndex + 1));
    if (!files.length) throw new Error('Usage: toolhub hash <file...> [--algo sha256]');
    return require('./src/tools/hash-tool').actions.hashFiles({ paths: files.map(file => path.resolve(file)), algo });
  },
  tree: async args => {
    if (!args[0]) throw new Error('Usage: toolhub tree <folder> [--text]');
    const result = await require('./src/tools/tree-export').actions.export({ root: path.resolve(args[0]), format: args.includes('--text') ? 'text' : 'markdown' });
    process.stdout.write(`${result.text}\n`);
    return { root: result.root, entries: result.count, truncated: result.truncated };
  },
  duplicates: async args => {
    if (!args[0]) throw new Error('Usage: toolhub duplicates <folder> [--match size|name|name-size]');
    const matchIndex = args.indexOf('--match');
    return require('./src/tools/duplicates').actions.scan({ roots: [path.resolve(args[0])], matchBy: matchIndex >= 0 ? args[matchIndex + 1] : 'hash' });
  },
  'file-types': async args => {
    if (!args[0]) throw new Error('Usage: toolhub file-types <folder>');
    return require('./src/tools/advanced-files').actions.fileTypeScan({ root: path.resolve(args[0]) });
  },
};

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === '-h') {
    console.log('Tool Hub CLI\n\nCommands:\n  toolhub hash <file...> [--algo sha256]\n  toolhub tree <folder> [--text]\n  toolhub duplicates <folder> [--match hash|size|name|name-size]\n  toolhub file-types <folder>');
    return;
  }
  const run = commands[command];
  if (!run) throw new Error(`Unknown command: ${command}`);
  const result = await run(args);
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main().catch(error => { console.error(`toolhub: ${error.message}`); process.exitCode = 1; });
module.exports = { main };
