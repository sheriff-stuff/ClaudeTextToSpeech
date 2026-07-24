// Self-serve tests — node --test test.mjs. No deps.
//
// Server and hook are exercised over real HTTP on a scratch port. The Speaker
// Page script is extracted from the served page and run in node:vm against
// stubbed browser globals, so speech behavior is testable without a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = 8790 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- server helpers ----------

let serverProc;

function startServer() {
  return new Promise((resolve, reject) => {
    serverProc = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
      env: { ...process.env, CLAUDE_TTS_PORT: String(PORT) },
    });
    serverProc.stdout.on('data', (d) => {
      if (String(d).includes('Question server')) resolve();
    });
    serverProc.on('error', reject);
  });
}

function listenSse() {
  // Collects SSE data lines; call .messages() after posting.
  const lines = [];
  let namedEvent = false;
  const req = http.get(`${BASE}/events`, (res) => {
    res.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        if (line.startsWith('event: ')) namedEvent = true;
        else if (line.startsWith('data: ')) { if (!namedEvent) lines.push(line.slice(6)); }
        else if (line === '') namedEvent = false;
      }
    });
  });
  return {
    messages: () => lines,
    close: () => req.destroy(),
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(body, headers = {}) {
  await fetch(`${BASE}/speak`, { method: 'POST', headers, body });
}

// ---------- page harness ----------

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.className = '';
    this.disabled = false;
    this.parent = null;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type) { for (const fn of this.listeners[type] ?? []) fn({ target: this }); }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  replaceChildren() { this.children = []; }
  remove() { const sibs = this.parent.children; sibs.splice(sibs.indexOf(this), 1); }
  get lastChild() { return this.children[this.children.length - 1]; }
  // Text nodes are modeled as elements; textContent is enough for asserts.
}

async function fetchPageScript() {
  const html = await (await fetch(`${BASE}/`)).text();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'page script found');
  return match[1];
}

function loadPage(script, { store = new Map() } = {}) {
  const ids = ['enable', 'status', 'status-text', 'log', 'voice', 'rate', 'rate-value', 'mute', 'test'];
  const byId = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  const spoken = [];
  const voices = [
    { name: 'Alice', lang: 'en-US' },
    { name: 'Bob', lang: 'en-GB' },
  ];
  let cancelled = false;
  let reloaded = false;

  class Utterance { constructor(text) { this.text = text; this.rate = 1; this.voice = null; } }
  class EventSource {
    constructor() { this.named = {}; context.eventSource = this; }
    addEventListener(type, fn) { (this.named[type] ??= []).push(fn); }
    fireEvent(type, data) { for (const fn of this.named[type] ?? []) fn({ data }); }
  }

  const context = {
    document: {
      getElementById: (id) => byId[id],
      createElement: (tag) => new FakeElement(tag),
      createTextNode: (text) => { const el = new FakeElement('#text'); el.textContent = text; return el; },
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    speechSynthesis: {
      getVoices: () => voices,
      speak: (u) => spoken.push(u),
      cancel: () => { cancelled = true; },
      addEventListener: () => {},
    },
    SpeechSynthesisUtterance: Utterance,
    EventSource,
    location: { reload: () => { reloaded = true; } },
    console,
  };
  vm.createContext(context);
  vm.runInContext(script, context);

  return {
    byId,
    spoken,
    store,
    wasCancelled: () => cancelled,
    wasReloaded: () => reloaded,
    fireEvent: (type, data) => context.eventSource.fireEvent(type, data),
    enable: () => byId.enable.fire('click'),
    receive: (data) => context.eventSource.onmessage({ data }),
    receiveJson: (obj) => context.eventSource.onmessage({ data: JSON.stringify(obj) }),
  };
}

// ---------- tests ----------

let pageScript;

test.before(async () => {
  await startServer();
  pageScript = await fetchPageScript();
});

test.after(() => serverProc.kill());

test('POST /speak with JSON body broadcasts text and session', async () => {
  const sse = listenSse();
  await wait(100);
  await post(JSON.stringify({ text: 'hello  from\njson', session: 's-1' }),
    { 'content-type': 'application/json' });
  await wait(200);
  sse.close();
  assert.deepEqual(JSON.parse(sse.messages()[0]), { text: 'hello from json', session: 's-1' });
});

test('POST /speak with plain text still works', async () => {
  const sse = listenSse();
  await wait(100);
  await post('plain text body');
  await wait(200);
  sse.close();
  assert.deepEqual(JSON.parse(sse.messages()[0]), { text: 'plain text body', session: '' });
});

test('hook forwards question text and session id', async () => {
  const sse = listenSse();
  await wait(100);
  const hook = spawn(process.execPath, [join(ROOT, '.claude', 'hooks', 'notify-question.mjs')], {
    env: { ...process.env, CLAUDE_TTS_PORT: String(PORT) },
  });
  hook.stdin.end(JSON.stringify({
    session_id: 'sess-42',
    tool_input: { questions: [{ question: 'Ship it?' }, { question: 'Which port?' }] },
  }));
  await new Promise((r) => hook.on('exit', r));
  await wait(200);
  sse.close();
  assert.deepEqual(JSON.parse(sse.messages()[0]),
    { text: 'Ship it? … Which port?', session: 'sess-42' });
});

test('page speaks a received question after enable', () => {
  const page = loadPage(pageScript);
  page.enable();
  page.receiveJson({ text: 'first question', session: 'a' });
  const texts = page.spoken.map((u) => u.text);
  assert.ok(texts.includes('first question'), `spoken: ${texts}`);
});

test('page does not speak before enable, but still logs', () => {
  const page = loadPage(pageScript);
  page.receiveJson({ text: 'too early', session: 'a' });
  assert.equal(page.spoken.length, 0);
  assert.equal(page.byId.log.children.length, 1);
});

test('mute blocks speech and cancels in-flight speech', () => {
  const page = loadPage(pageScript);
  page.enable();
  page.byId.mute.checked = true;
  page.byId.mute.fire('change');
  assert.ok(page.wasCancelled());
  const before = page.spoken.length;
  page.receiveJson({ text: 'silenced', session: 'a' });
  assert.equal(page.spoken.length, before);
  assert.equal(page.byId.log.children.length, 1);
  assert.equal(page.store.get('tts.mute'), 'true');
});

test('voice and rate apply to utterances and persist', () => {
  const page = loadPage(pageScript);
  page.enable();
  page.byId.voice.value = 'Bob';
  page.byId.voice.fire('change');
  page.byId.rate.value = '1.5';
  page.byId.rate.fire('change');
  page.receiveJson({ text: 'styled', session: 'a' });
  const u = page.spoken.at(-1);
  assert.equal(u.text, 'styled');
  assert.equal(u.voice?.name, 'Bob');
  assert.equal(u.rate, 1.5);
  assert.equal(page.store.get('tts.voice'), 'Bob');
  assert.equal(page.store.get('tts.rate'), '1.5');
});

test('settings load from localStorage on startup', () => {
  const store = new Map([['tts.voice', 'Alice'], ['tts.rate', '0.8'], ['tts.mute', 'false']]);
  const page = loadPage(pageScript, { store });
  page.enable();
  page.receiveJson({ text: 'restored', session: 'a' });
  const u = page.spoken.at(-1);
  assert.equal(u.voice?.name, 'Alice');
  assert.equal(u.rate, 0.8);
});

test('single session speaks without prefix; second session adds prefixes', () => {
  const page = loadPage(pageScript);
  page.enable();
  page.receiveJson({ text: 'alone', session: 'aaa' });
  assert.equal(page.spoken.at(-1).text, 'alone');
  page.receiveJson({ text: 'newcomer', session: 'bbb' });
  assert.equal(page.spoken.at(-1).text, 'session 2 asks: newcomer');
  page.receiveJson({ text: 'back again', session: 'aaa' });
  assert.equal(page.spoken.at(-1).text, 'session 1 asks: back again');
});

test('plain-text SSE data falls back to speaking the raw text', () => {
  const page = loadPage(pageScript);
  page.enable();
  page.receive('not json at all');
  assert.equal(page.spoken.at(-1).text, 'not json at all');
});

test('test button speaks with current settings, even muted and before enable', () => {
  const store = new Map([['tts.voice', 'Bob'], ['tts.rate', '1.5'], ['tts.mute', 'true']]);
  const page = loadPage(pageScript, { store });
  page.byId.test.fire('click');
  const u = page.spoken.at(-1);
  assert.ok(u, 'utterance spoken');
  assert.equal(u.voice?.name, 'Bob');
  assert.equal(u.rate, 1.5);
});

test('page reloads on pagetag mismatch, stays put on match', () => {
  const tag = pageScript.match(/PAGE_TAG = '([0-9a-f]{12})'/)?.[1];
  assert.ok(tag, 'embedded page tag found');
  const page = loadPage(pageScript);
  page.fireEvent('pagetag', tag);
  assert.equal(page.wasReloaded(), false);
  page.fireEvent('pagetag', 'somethingelse');
  assert.equal(page.wasReloaded(), true);
});

test('served page and SSE announce the same tag', async () => {
  const html = await (await fetch(`${BASE}/`)).text();
  const embedded = html.match(/PAGE_TAG = '([0-9a-f]{12})'/)?.[1];
  const announced = await new Promise((resolve) => {
    const req = http.get(`${BASE}/events`, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        const m = buf.match(/event: pagetag\ndata: ([0-9a-f]{12})/);
        if (m) { req.destroy(); resolve(m[1]); }
      });
    });
  });
  assert.equal(announced, embedded);
});

test('log keeps at most 10 entries', () => {
  const page = loadPage(pageScript);
  for (let i = 0; i < 15; i++) page.receiveJson({ text: `q${i}`, session: 'a' });
  assert.equal(page.byId.log.children.length, 10);
});
