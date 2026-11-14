const manifest = await Bun.file('dist/manifest.webmanifest').json() as {
  name: string;
  short_name: string;
  id: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Array<{ src: string; sizes: string; purpose: string }>;
};
const html = await Bun.file('dist/index.html').text();
const worker = await Bun.file('dist/sw.js').text();
const problems: string[] = [];

function expect(condition: boolean, message: string) {
  if (!condition) problems.push(message);
}

expect(manifest.name === 'canvas' && manifest.short_name === 'canvas', 'manifest name');
expect(manifest.id === '/canvas/', 'manifest id');
expect(manifest.start_url === '/canvas/' || manifest.start_url.endsWith('/canvas/'), `start ${manifest.start_url}`);
expect(manifest.scope === '/canvas/' || manifest.scope.endsWith('/canvas/'), `scope ${manifest.scope}`);
expect(manifest.display === 'standalone', 'display');
expect(manifest.theme_color === '#14171b' && manifest.background_color === '#14171b', 'colors');
expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.purpose.includes('any')), '192 icon');
expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('any') && icon.src.includes('app-512')), '512 icon');
expect(manifest.icons.some((icon) => icon.purpose.includes('maskable') && icon.src.includes('app-maskable-512')), 'maskable icon');
expect(!html.includes('href="/favicon.ico"'), 'favicon stays under the canvas base');
expect(html.includes('/canvas/favicon.ico'), 'favicon href');
expect(html.includes('manifest.webmanifest'), 'manifest link');
expect(worker.includes('DitherAtlasLayer'), 'atlas chunk precached');
expect(worker.includes('TopographicContoursLayer'), 'contours chunk precached');
expect(worker.includes('.woff2'), 'font precached');
expect(worker.includes('.css'), 'css precached');
expect(worker.includes('index.html'), 'shell precached');
expect(worker.includes('app-maskable-512.png'), 'maskable icon precached');
expect(!await Bun.file('dist/site.webmanifest').exists(), 'placeholder site.webmanifest absent');
expect(!await Bun.file('dist/manifest.json').exists(), 'placeholder manifest.json absent');
expect(worker.includes('SKIP_WAITING') && worker.includes('skipWaiting()'), 'update waits for an explicit message');
expect(!worker.includes('self.skipWaiting()') || worker.includes('SKIP_WAITING'), 'skipWaiting is not unconditional');

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log('pwa output ok');
