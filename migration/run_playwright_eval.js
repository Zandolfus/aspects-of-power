// Tiny wrapper: read a JS file and pass its contents as a single argv to
// playwright-cli eval. Avoids PowerShell/cmd.exe arg-splitting on spaces +
// quotes inside multi-line scripts.
//
// Usage: node migration/run_playwright_eval.js <path-to-script.js>
const fs = require('fs');
const { spawnSync } = require('child_process');

const path = process.argv[2];
if (!path) { console.error('usage: node run_playwright_eval.js <script.js>'); process.exit(2); }
const script = fs.readFileSync(path, 'utf8');

const r = spawnSync(
  'C:\\nvm4w\\nodejs\\node.exe',
  ['C:\\nvm4w\\nodejs\\node_modules\\@playwright\\cli\\playwright-cli.js', 'eval', script],
  { stdio: 'inherit' }
);
process.exit(r.status ?? 1);
