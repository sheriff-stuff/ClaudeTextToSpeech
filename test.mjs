// node --test test.mjs
//
// Covers the cleaner, the Stop payload handling, and the real spawned
// pipeline against stub binaries that record their argv and stdin. Whether it
// sounds any good is the one thing only ears can judge: see smoke.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildArgs, cleanForSpeech, findPiper, findVoice, handle, mutePath, pidPath, sampleRateFor,
} from './.claude/hooks/speak-reply.mjs';
import { playerArgs } from './.claude/hooks/speak-run.mjs';

const HOOK = fileURLToPath(new URL('./.claude/hooks/speak-reply.mjs', import.meta.url));

test('cleaner replaces fenced code with a line count', () => {
  const out = cleanForSpeech('Try this:\n```js\nconst a = 1;\nconst b = 2;\n```\nDone.');
  assert.match(out, /code block, 2 lines/);
  assert.doesNotMatch(out, /const/);
});

test('cleaner counts a one-line block in the singular', () => {
  assert.match(cleanForSpeech('```\nx\n```'), /code block, 1 line\b/);
});

test('cleaner handles an unterminated fence', () => {
  const out = cleanForSpeech('Here:\n```js\nconst a = 1;');
  assert.equal(out, 'Here:\ncode block.');
});

test('cleaner keeps inline code and paths as words', () => {
  assert.equal(cleanForSpeech('Edit `server.mjs:42` now'), 'Edit server.mjs:42 now');
});

test('cleaner strips headings, bullets, quotes and rules', () => {
  const out = cleanForSpeech('## Plan\n\n- first\n- second\n\n---\n\n> note');
  assert.equal(out, 'Plan\nfirst\nsecond\nnote');
});

test('cleaner strips links, images and emphasis', () => {
  assert.equal(cleanForSpeech('See [the docs](http://x/y) **now** and *soon*'), 'See the docs now and soon');
  assert.equal(cleanForSpeech('![a diagram](x.png)'), 'a diagram');
});

test('cleaner keeps an asterisk that is not emphasis', () => {
  assert.equal(cleanForSpeech('use 2 * 3 here'), 'use 2 * 3 here');
});

test('cleaner reads a table row as a sentence', () => {
  const out = cleanForSpeech('| Voice | Size |\n| --- | --- |\n| alba | 60MB |');
  assert.equal(out, 'Voice, Size\nalba, 60MB');
});

test('cleaner returns empty for whitespace', () => {
  assert.equal(cleanForSpeech('   \n\n  '), '');
  assert.equal(cleanForSpeech(undefined), '');
});

test('sampleRateFor reads the voice config, else falls back', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-voice-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const voice = path.join(dir, 'en_GB-alba-medium.onnx');
  fs.writeFileSync(voice, '');
  fs.writeFileSync(`${voice}.json`, JSON.stringify({ audio: { sample_rate: 16000 } }));
  assert.equal(sampleRateFor(voice), 16000);
  assert.equal(sampleRateFor(path.join(dir, 'missing.onnx')), 22050);
});

test('buildArgs points the runner at piper, the voice and the player', () => {
  const args = buildArgs({
    piper: 'piper.exe', voice: 'alba.onnx', player: 'ffplay',
    textFile: 'say.txt', rate: 22050,
  });
  assert.match(args[0], /speak-run\.mjs$/);
  assert.deepEqual(args.slice(1), ['piper.exe', 'alba.onnx', 'ffplay', '22050', 'say.txt']);
});

test('the environment overrides discovery', () => {
  assert.equal(findPiper({ CLAUDE_TTS_PIPER: 'X:\\elsewhere\\piper.exe' }), 'X:\\elsewhere\\piper.exe');
  assert.equal(findVoice({ CLAUDE_TTS_VOICE: 'X:\\elsewhere\\v.onnx' }), 'X:\\elsewhere\\v.onnx');
});

test('discovery finds a standard install, or nothing', () => {
  // Whether this box has Piper installed is not the test's business; that the
  // two answers agree is.
  const piper = findPiper({});
  const voice = findVoice({});
  if (piper) assert.ok(fs.existsSync(piper), `${piper} was reported but is missing`);
  if (voice) assert.match(voice, /\.onnx$/);
});

test('handle stays silent with no piper anywhere', (t) => {
  // Discovery must not find a real install and make this pass by accident.
  const found = findPiper({});
  if (found) return t.skip(`Piper is installed at ${found}`);
  assert.equal(handle({ last_assistant_message: 'hello' }, {}), false);
});

test('handle stays silent on a hook-driven continuation', () => {
  assert.equal(handle({ last_assistant_message: 'hello', stop_hook_active: true },
    { CLAUDE_TTS_PIPER: 'p', CLAUDE_TTS_VOICE: 'v' }), false);
});

test('handle stays silent while the mute file exists', (t) => {
  const mute = mutePath();
  const existed = fs.existsSync(mute);
  if (!existed) fs.writeFileSync(mute, '');
  t.after(() => { if (!existed) fs.rmSync(mute, { force: true }); });
  assert.equal(handle({ last_assistant_message: 'hello' },
    { CLAUDE_TTS_PIPER: 'p', CLAUDE_TTS_VOICE: 'v' }), false);
});

// The stub player accepts any argument, so it once let a pipeline ship that
// ffplay rejected outright. This checks the arguments against the real thing:
// 50ms of silence, which exits 0 if and only if the flags are accepted.
test('the real player accepts the arguments we pass it', async (t) => {
  const player = process.env.CLAUDE_TTS_PLAYER || 'ffplay';
  const silence = Buffer.alloc(2 * Math.round(22050 * 0.05));
  const code = await new Promise((resolve) => {
    const child = spawn(player, playerArgs(22050), { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => resolve('missing'));
    child.on('exit', (status) => resolve(status === 0 ? 0 : `${status}: ${stderr.trim()}`));
    child.stdin.on('error', () => {});
    child.stdin.end(silence);
  });
  if (code === 'missing') return t.skip(`${player} is not installed`);
  assert.equal(code, 0);
});

// --- end to end, through the real spawned runner ---------------------------

// Stubs standing in for piper and the player: each records the argv it was
// given and the bytes it was fed, so the whole chain is observable. They are
// .cmd wrappers, which is also the awkward case the runner has to handle:
// Node refuses to spawn a .cmd without a shell.
const STUB = `
import fs from 'node:fs';
const [target, name, ...argv] = process.argv.slice(2);
fs.writeFileSync(target + '/' + name + '-argv.txt', argv.join(' '));
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  fs.writeFileSync(target + '/' + name + '-stdin.txt', Buffer.concat(chunks));
  if (name === 'piper') process.stdout.write('AUDIO');
});
`;

function stubs(dir) {
  const script = path.join(dir, 'stub.mjs');
  fs.writeFileSync(script, STUB);
  const cmd = (name) => {
    const file = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(file, `@echo off\r\n"${process.execPath}" "${script}" "${dir}" ${name} %*\r\n`);
    return file;
  };
  const piper = cmd('piper');
  const player = cmd('player');
  const voice = path.join(dir, 'alba.onnx');
  fs.writeFileSync(voice, '');
  fs.writeFileSync(`${voice}.json`, JSON.stringify({ audio: { sample_rate: 22050 } }));
  return { piper, player, voice };
}

async function waitForFile(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.statSync(file).size > 0) return fs.readFileSync(file, 'utf8');
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${file}`);
}

function runHook(payload, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('exit', (code) => resolve(code));
    child.stdin.end(JSON.stringify(payload));
  });
}

test('the hook spawns the pipeline and exits 0 without waiting for it', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-e2e-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { piper, player, voice } = stubs(dir);

  const code = await runHook(
    { hook_event_name: 'Stop', last_assistant_message: '## Done\n\nFixed `parser.mjs`.' },
    { CLAUDE_TTS_PIPER: piper, CLAUDE_TTS_VOICE: voice, CLAUDE_TTS_PLAYER: player },
  );
  assert.equal(code, 0);

  const piperArgv = await waitForFile(path.join(dir, 'piper-argv.txt'));
  assert.match(piperArgv, /--model/);
  assert.match(piperArgv, /--output_raw/);

  const spoken = await waitForFile(path.join(dir, 'piper-stdin.txt'));
  assert.match(spoken, /Done/);
  assert.match(spoken, /Fixed parser\.mjs\./);
  assert.doesNotMatch(spoken, /#|`/);

  const playerArgv = await waitForFile(path.join(dir, 'player-argv.txt'));
  assert.match(playerArgv, /-ar 22050/);
  assert.match(playerArgv, /-nodisp/);

  assert.match(await waitForFile(path.join(dir, 'player-stdin.txt')), /AUDIO/);
});

test('a second reply records a new pipeline pid', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-pid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { piper, player, voice } = stubs(dir);
  const env = { CLAUDE_TTS_PIPER: piper, CLAUDE_TTS_VOICE: voice, CLAUDE_TTS_PLAYER: player };

  await runHook({ last_assistant_message: 'first reply' }, env);
  await waitForFile(path.join(dir, 'piper-stdin.txt'));
  const first = await waitForFile(pidPath());

  await runHook({ last_assistant_message: 'second reply' }, env);
  const deadline = Date.now() + 10_000;
  let second = first;
  while (second === first && Date.now() < deadline) {
    second = await waitForFile(pidPath());
    if (second === first) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.notEqual(second, first);
});
