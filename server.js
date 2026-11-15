const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;   // serves the folder this file lives in (no hardcoded Windows path)
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }   // block ../ traversal
  fs.readFile(filePath, (err, content) => {
<<<<<<< HEAD
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*'
    });
=======
    if (err) {
      console.log('404 ' + req.url + ' -> ' + filePath);
      res.writeHead(404); res.end('Not found'); return;
    }
    console.log('200 ' + req.url + ' (' + (content.length / 1024 / 1024).toFixed(2) + ' MB)');
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
>>>>>>> origin/main
    res.end(content);
  });
});
server.listen(8080, () => console.log('Static server on http://localhost:8080'));
