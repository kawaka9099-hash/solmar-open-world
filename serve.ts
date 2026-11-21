// Solmar — serve.ts
// A tiny static dev server for the game. Standard library only.
//
// Usage: node serve.ts [port]     (default 8080)
// Then open http://localhost:8080/ in a browser.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const port = Number(process.argv[2] || 8080);
const root = resolve(import.meta.dirname, 'game');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let path = join(root, url === '/' ? 'index.html' : url);
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  try {
    const data = readFileSync(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch (_e) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(port, () => {
  console.log(`Solmar is running at http://localhost:${port}/`);
});
