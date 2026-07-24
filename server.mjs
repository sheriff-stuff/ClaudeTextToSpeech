// Question Server — receives question text from the Claude Code hook and
// broadcasts it to connected Speaker Pages over SSE. Node 18+, no deps.
//
//   node server.mjs
//
// Port comes from CLAUDE_TTS_PORT (default 8765). Binds 127.0.0.1 only.

import http from 'node:http';
import crypto from 'node:crypto';

const VERSION = '0.8';
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
  :root { color-scheme: dark; }
  body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; background: #0d1117; color: #e6edf3; }
  #enable { font-size: 1.2rem; padding: .6rem 1.4rem; cursor: pointer; }
  #status { margin: 1rem 0; }
  #status .dot { display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; margin-right: .4rem; }
  .connected .dot { background: #3fb950; }
  .disconnected .dot { background: #f85149; }
  #log { list-style: none; padding: 0; }
  #log li { padding: .4rem 0; border-bottom: 1px solid #30363d; }
  #log time { color: #8b949e; font-size: .85em; margin-right: .6rem; }
  #log .session { color: #8b949e; font-size: .85em; margin-right: .6rem; }
  #controls { border: 1px solid #30363d; border-radius: .4rem; padding: .8rem 1rem; margin: 1rem 0; display: flex; flex-wrap: wrap; gap: 1rem 1.5rem; align-items: center; }
  #controls label { display: flex; align-items: center; gap: .4rem; }
  #voice { max-width: 16rem; }
  h1 .version { font-size: .5em; font-weight: normal; color: #8b949e; margin-left: .5rem; vertical-align: middle; }
</style>
</head>
<body>
<h1>Claude question speaker<span class="version">v${VERSION}</span></h1>
<button id="enable">Enable sound</button>
<fieldset id="controls">
  <legend>Speech</legend>
  <label>Voice <select id="voice"></select></label>
  <label>Rate <input type="range" id="rate" min="0.5" max="2" step="0.1"> <span id="rate-value"></span></label>
  <label><input type="checkbox" id="mute"> Mute</label>
  <button id="test">Test</button>
</fieldset>
<p id="status" class="disconnected"><span class="dot"></span><span id="status-text">not connected</span></p>
<ul id="log"></ul>
<script>
  const LOG_MAX = 10;
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('status-text');
  const logEl = document.getElementById('log');
  const voiceEl = document.getElementById('voice');
  const rateEl = document.getElementById('rate');
  const rateValueEl = document.getElementById('rate-value');
  const muteEl = document.getElementById('mute');
  let enabled = false;

  // Settings persisted to localStorage.
  const settings = {
    voice: localStorage.getItem('tts.voice') || '',
    rate: Number(localStorage.getItem('tts.rate')) || 1,
    mute: localStorage.getItem('tts.mute') === 'true',
  };

  rateEl.value = settings.rate;
  rateValueEl.textContent = settings.rate.toFixed(1);
  muteEl.checked = settings.mute;

  function populateVoices() {
    const voices = speechSynthesis.getVoices();
    voiceEl.replaceChildren();
    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'default';
    voiceEl.appendChild(auto);
    for (const v of voices) {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name + ' (' + v.lang + ')';
      voiceEl.appendChild(opt);
    }
    voiceEl.value = voices.some((v) => v.name === settings.voice) ? settings.voice : '';
  }
  populateVoices();
  speechSynthesis.addEventListener('voiceschanged', populateVoices);

  function utter(text) {
    const u = new SpeechSynthesisUtterance(text);
    const voice = speechSynthesis.getVoices().find((v) => v.name === settings.voice);
    if (voice) u.voice = voice;
    u.rate = settings.rate;
    speechSynthesis.speak(u);
  }

  function speak(text) {
    if (!enabled || settings.mute) return;
    utter(text);
  }

  voiceEl.addEventListener('change', () => {
    settings.voice = voiceEl.value;
    localStorage.setItem('tts.voice', settings.voice);
    speak('this is the new voice');
  });

  rateEl.addEventListener('change', () => {
    settings.rate = Number(rateEl.value);
    rateValueEl.textContent = settings.rate.toFixed(1);
    localStorage.setItem('tts.rate', String(settings.rate));
    speak('this is the new rate');
  });

  rateEl.addEventListener('input', () => {
    rateValueEl.textContent = Number(rateEl.value).toFixed(1);
  });

  document.getElementById('test').addEventListener('click', () => {
    // Deliberate gesture: speaks even before enable and while muted.
    utter('this is how questions will sound');
  });

  muteEl.addEventListener('change', () => {
    settings.mute = muteEl.checked;
    localStorage.setItem('tts.mute', String(settings.mute));
    if (settings.mute) speechSynthesis.cancel();
  });

  // Session ids get short labels in arrival order. The spoken prefix only
  // kicks in once a second session shows up.
  const sessions = new Map();
  function sessionLabel(id) {
    if (!id) return 0;
    if (!sessions.has(id)) sessions.set(id, sessions.size + 1);
    return sessions.get(id);
  }

  function logQuestion(text, label) {
    const li = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date().toLocaleTimeString();
    li.appendChild(time);
    if (label) {
      const span = document.createElement('span');
      span.className = 'session';
      span.textContent = 'S' + label;
      li.appendChild(span);
    }
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
    // Always utter here, even muted: the gesture must reach speechSynthesis
    // once to unlock audio.
    utter(settings.mute ? '' : 'sound enabled');
  });

  const events = new EventSource('/events');
  events.onopen = () => setStatus(true);
  events.onerror = () => setStatus(false);
  // Hot reload: the server sends its page hash on connect; a mismatch after a
  // reconnect means the page changed under us (dev runs node --watch).
  const PAGE_TAG = '__PAGE_TAG__';
  events.addEventListener('pagetag', (e) => {
    if (e.data !== PAGE_TAG) location.reload();
  });
  events.onmessage = (e) => {
    let text = e.data;
    let session = '';
    try {
      const parsed = JSON.parse(e.data);
      if (parsed && typeof parsed.text === 'string') {
        text = parsed.text;
        session = parsed.session || '';
      }
    } catch {}
    const label = sessionLabel(session);
    const spoken = label && sessions.size > 1 ? 'session ' + label + ' asks: ' + text : text;
    // Speak inside the event handler: network events wake background tabs,
    // timers don't.
    speak(spoken);
    logQuestion(text, label);
  };
</script>
</body>
</html>
`;

// Hash over the page with the placeholder still in it, then substitute — the
// tag can't hash a page that already contains itself.
const PAGE_TAG = crypto.createHash('sha1').update(PAGE).digest('hex').slice(0, 12);
const HTML = PAGE.replace('__PAGE_TAG__', PAGE_TAG);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/speak') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // JSON payload from the hook; plain text still accepted (curl, old hooks).
      let text = body;
      let session = '';
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.text === 'string') {
          text = parsed.text;
          session = typeof parsed.session === 'string' ? parsed.session : '';
        }
      } catch {}
      text = text.replaceAll(/\s+/g, ' ').trim();
      if (text) {
        const data = JSON.stringify({ text, session });
        for (const client of clients) client.write(`data: ${data}\n\n`);
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
    res.write(`event: pagetag\ndata: ${PAGE_TAG}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML);
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
