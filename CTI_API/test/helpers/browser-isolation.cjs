'use strict';

// An explicit browser regression harness, separate from the dependency-free app.
// Every request reaches only an ephemeral fixture owned by this test process.
const http = require('node:http');

async function isolatedBrowser(chromium, executablePath) {
  const allowed = new Set();
  const proxyDenials = [];
  const routeDenials = [];
  const proxy = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !allowed.has(url.origin)) {
      proxyDenials.push(url.origin); res.writeHead(403); res.end(); return;
    }
    const upstream = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  // Chrome may reset a denied background CONNECT socket during teardown.
  // Handle that transport close without changing the origin allowlist.
  proxy.on('connection', socket => socket.on('error', error => {
    if (error.code !== 'ECONNRESET') throw error;
  }));
  proxy.on('connect', (req, socket) => {
    proxyDenials.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: [
      `--proxy-server=http://127.0.0.1:${proxy.address().port}`, '--proxy-bypass-list=<-loopback>', '--disable-quic',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    ] });
  } catch (error) { await new Promise(resolve => proxy.close(resolve)); throw error; }
  return {
    browser, proxyDenials, routeDenials,
    async context(base) {
      allowed.add(base);
      const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        routeDenials.push(url.href); return route.abort();
      });
      return context;
    },
    async close() {
      await browser.close(); proxy.closeAllConnections();
      await new Promise(resolve => proxy.close(resolve));
    },
  };
}

module.exports = { isolatedBrowser };
