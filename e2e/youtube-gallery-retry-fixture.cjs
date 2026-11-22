// Local, deterministic HTTP failure fixture for ordinary browser testing.
// No Firebase session, paid AI, production writes, or browser resizing.
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'veloxa-gallery-retry-'));
  const bundle = path.join(directory, 'fixture.js');
  await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import { createRoot } from 'react-dom/client';
    import { VeloxaYouTubeSceneGallery } from './src/components/VeloxaYouTubeSceneGallery';
    const production = { id: 'fixture', state: 'producing', settings: { kind: 'short' },
      blocks: [{ scenes: [{ title: 'Contoh adegan', narration: 'Narasi contoh untuk memeriksa pemulihan gambar.' }] }],
      progress: { images: 1 } } as any;
    createRoot(document.getElementById('root')!).render(<VeloxaYouTubeSceneGallery production={production} media={name => '/preview.svg?name=' + encodeURIComponent(name)} />);
  ` }, bundle: true, outfile: bundle, jsx: 'automatic', platform: 'browser' });
  const javascript = await fs.readFile(bundle);
  const attempts = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(javascript); }
    if (url.pathname === '/counts') { response.setHeader('Content-Type', 'application/json'); return response.end(JSON.stringify({ attempts: attempts.length, retries: attempts })); }
    if (url.pathname === '/preview.svg') {
      attempts.push(url.searchParams.get('previewRetry'));
      if (attempts.length <= 2) { response.statusCode = 503; return response.end('Temporary preview interruption'); }
      response.setHeader('Content-Type', 'image/svg+xml');
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#fff7ee"/><text x="60" y="200" font-size="48">Pratinjau pulih</text></svg>');
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:16px sans-serif}.opacity-0{opacity:0}img{width:180px}figure{width:240px}.relative{position:relative}.absolute{position:absolute;top:0}</style><div id="root"></div><script src="/fixture.js"></script>');
  });
  server.listen(8796, '127.0.0.1', () => process.stdout.write('Gallery retry fixture ready at http://localhost:8796\n'));
  process.once('SIGTERM', () => server.close(() => fs.rm(directory, { recursive: true, force: true }).finally(() => process.exit(0))));
})().catch(error => { console.error(error); process.exitCode = 1; });
