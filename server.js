const http = require('http');
const fs = require('fs');
const path = require('path');
const root = 'C:\\Users\\Ajmaleee Hackathon\\Desktop\\space';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.glb': 'model/gltf-binary', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let filePath = path.join(root, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath).toLowerCase();
  const type = mime[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(content);
  });
});
server.listen(8080, () => console.log('Static server on http://localhost:8080'));
