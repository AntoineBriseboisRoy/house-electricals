/**
 * Tiny zero-dependency static server for the design-exploration HTML pages in
 * this folder. Not part of the app build — purely for previewing the mockups.
 *
 *   node docs/design/serve.mjs        # → http://127.0.0.1:4191/
 *
 * Root is pinned to THIS directory (via import.meta.url), so cwd doesn't
 * matter and it can't serve files outside docs/design.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 4191;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = normalize(join(ROOT, p));
    if (file !== ROOT.replace(/[\\/]$/, '') && !file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`design preview server: http://127.0.0.1:${PORT}/`);
});
