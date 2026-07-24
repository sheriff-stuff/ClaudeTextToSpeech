// Question Server — receives question text from the Claude Code hook and
// broadcasts it to connected Speaker Pages over SSE. Node 18+, no deps.
//
//   node server.mjs
//
// Port comes from CLAUDE_TTS_PORT (default 8765). Binds 127.0.0.1 only.

import http from 'node:http';

const VERSION = '0.5';
const PORT = Number(process.env.CLAUDE_TTS_PORT) || 8765;
const HEARTBEAT_MS = 30_000;

const clients = new Set();

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claude question speaker</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; }
  #enable { font-size: 1.2rem; padding: .6rem 1.4rem; cursor: pointer; }
  #status { margin: 1rem 0; }
  #status .dot { display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; margin-right: .4rem; }
  .connected .dot { background: #2da44e; }
  .disconnected .dot { background: #cf222e; }
  #log { list-style: none; padding: 0; }
  #log li { padding: .4rem 0; border-bottom: 1px solid #ddd; }
  #log time { color: #666; font-size: .85em; margin-right: .6rem; }
  h1 .version { font-size: .5em; font-weight: normal; color: #666; margin-left: .5rem; vertical-align: middle; }
</style>
</head>
<body>
<h1>Claude question speaker<span class="version">v${VERSION}</span></h1>
<button id="enable">Enable sound</button>
<p id="status" class="disconnected"><span class="dot"></span><span id="status-text">not connected</span></p>
<ul id="log"></ul>
<script>
  const LOG_MAX = 10;
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const logEl = document.getElementById('log');
  let enabled = false;

  function speak(text) {
    if (!enabled) return;
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }

  function logQuestion(text) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString();
    li.appendChild(time);
    li.appendChild(document.createTextNode(text));
    logEl.prepend(li);
    while (logEl.children.length > LOG_MAX) logEl.lastChild.remove();
  }

  function setStatus(connected) {
    statusEl.className = connected ? 'connected' : 'disconnected';
    statusText.textContent = connected ? 'connected' : 'reconnecting…';
  }

  document.getElementById('enable').addEventListener('click', (e) => {
    enabled = true;
    e.target.disabled = true;
    e.target.textContent = 'Sound enabled';
    speechSynthesis.speak(new SpeechSynthesisUtterance('sound enabled'));
  });

  const events = new EventSource('/events');
  events.onopen = () => setStatus(true);
  events.onerror = () => setStatus(false);
  events.onmessage = (e) => {
    // Speak inside the event handler: network events wake background tabs,
    // timers don't.
    speak(e.data);
    logQuestion(e.data);
  };
</script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/speak') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const text = body.replaceAll(/\s+/g, ' ').trim();
      if (text) {
        for (const client of clients) client.write(`data: ${text}\n\n`);
        console.log(`[speak] ${clients.size} listener(s): ${text}`);
      }
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
    return;
  }

  res.writeHead(404).end();
});

setInterval(() => {
  for (const client of clients) client.write(': heartbeat\n\n');
}, HEARTBEAT_MS).unref();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Question server on http://127.0.0.1:${PORT}`);
});
