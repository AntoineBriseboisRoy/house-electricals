// Cycle-81 — motion-easing literal gate.
//
// Defends the cycle-81 ADR "motion-easing tokens are the SSOT for
// animation timing curves" rule (and transitively the cycle-11 G11
// tokens-are-SSOT rule). Animation + transition declarations in
// styles.css MUST use `var(--motion-ease-out)` or
// `var(--motion-ease-in-out)` rather than the bare CSS keywords
// `ease-out` / `ease-in-out`.
//
// STRICT regex `\b(ease-out|ease-in-out)\b` with a negative lookbehind
// for the `--motion-` token prefix so canonical token usages are not
// flagged. Bare `ease` is NOT flagged — the cycle-22 theme-transition
// (styles.css L173-175) uses bare `ease` intentionally as a softer
// 800ms feel. Bare `linear` is also NOT flagged (he-spin + marching-
// ants rhythm).
//
// CARVE-OUTS (lines INSIDE these scopes are skipped):
//   - inside `@keyframes` blocks (no current matches, defensive)
//   - inside `.printable-page` rule blocks (cycle-27 G24 ADR —
//     paper artifact theme-invariant; would never use motion tokens
//     anyway, but we exclude defensively)
//
// Exits 1 if any unscoped `ease-out` / `ease-in-out` literal is
// found, listing the offending line. Exits 0 otherwise.
//
// Cross-platform Node ESM mirrors the cycle-77
// scripts/check-illustration-hex.mjs pattern.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_FILE = resolve(__dirname, '..', 'src', 'styles.css');

// Negative lookbehind for `--motion-` so canonical token usages
// (e.g. `var(--motion-ease-out)`) don't match.
const BARE_EASE_RE = /(?<!--motion-)\b(ease-out|ease-in-out)\b/g;

const text = readFileSync(STYLES_FILE, 'utf8');
const lines = text.split('\n');

// Walk the file line-by-line and track brace depth + carve-out
// scopes. CSS doesn't have nested selectors here (no preprocessor),
// but rules can be nested inside `@media` / `@keyframes`. We track
// depth so a single open-brace puts us inside a rule, and the
// printable-page / keyframes carve-out persists until its matching
// close-brace.
let depth = 0;
let carveDepth = -1; // -1 = not in a carve-out
const violations = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Detect carve-out openers BEFORE counting braces on this line.
  // The opener line itself is inside the carve-out (e.g. the `{` is
  // on the same line as the selector).
  if (carveDepth === -1) {
    // `.printable-page` standalone block (not `.printable-page__foo`
    // or `.printable-page .descendant`) — be permissive: any rule
    // whose selector mentions `.printable-page` is theme-invariant.
    if (line.includes('.printable-page') && line.includes('{')) {
      carveDepth = depth;
    } else if (/@keyframes\b/.test(line) && line.includes('{')) {
      carveDepth = depth;
    }
  }

  // Count braces on this line to update depth.
  for (const ch of line) {
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      // Exit the carve-out when we close past its opening depth.
      if (carveDepth !== -1 && depth <= carveDepth) {
        carveDepth = -1;
      }
    }
  }

  // Skip lines inside a carve-out.
  if (carveDepth !== -1) {
    continue;
  }

  BARE_EASE_RE.lastIndex = 0;
  const matches = line.match(BARE_EASE_RE);
  if (matches !== null && matches.length > 0) {
    violations.push({
      line: i + 1,
      snippet: line.trim(),
      matches,
    });
  }
}

if (violations.length > 0) {
  console.error(
    'FAIL: bare easing keyword(s) found in styles.css — use var(--motion-ease-out) or var(--motion-ease-in-out).'
  );
  for (const v of violations) {
    console.error(`  ${STYLES_FILE}:${v.line}  [${v.matches.join(', ')}]`);
    console.error(`    ${v.snippet}`);
  }
  process.exit(1);
}

console.log(
  `[lint:motion] OK — styles.css scanned, 0 bare ease-out / ease-in-out literal(s) outside carve-outs.`
);
process.exit(0);
