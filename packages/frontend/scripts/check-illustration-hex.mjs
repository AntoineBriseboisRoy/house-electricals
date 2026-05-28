// Cycle-77 — illustration hex-literal gate.
//
// Defends the cycle-76 "no hex literals in illustration SVGs" rule
// (and transitively the cycle-23 G22 FATAL #1 "tokens are the SSOT"
// rule). Bespoke SVG illustrations in `src/ui/illustrations/` MUST
// use only `currentColor` or `var(--color-*)` for stroke + fill.
//
// Exits 1 if any `#[0-9a-fA-F]{3,8}` match is found, listing the
// offending file + line. Exits 0 otherwise.
//
// Cross-platform (no shelling out to grep) so Windows + POSIX dev
// machines + CI both run the same gate.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ILLUSTRATIONS_DIR = resolve(__dirname, '..', 'src', 'ui', 'illustrations');
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
};

const files = walk(ILLUSTRATIONS_DIR);
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    HEX_RE.lastIndex = 0;
    const matches = line.match(HEX_RE);
    if (matches !== null && matches.length > 0) {
      violations.push({
        file,
        line: idx + 1,
        snippet: line.trim(),
        matches,
      });
    }
  });
}

if (violations.length > 0) {
  console.error(
    'FAIL: hex literal(s) found in illustration SVG — use currentColor or var(--color-*).'
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.matches.join(', ')}]`);
    console.error(`    ${v.snippet}`);
  }
  process.exit(1);
}

console.log(
  `[lint:illustrations] OK — ${files.length} file(s) scanned, 0 hex literal(s).`
);
process.exit(0);
