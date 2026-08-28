// Stop hook — speaks Claude's final reply aloud with Piper.
//
// Claude Code passes `last_assistant_message` on the Stop event, so the reply
// text arrives directly and the transcript is never read. The text is cleaned
// for the ear, handed to speak-run.mjs, and piped through Piper into a
// player. Fire-and-forget: the runner is detached and this process exits 0
// immediately, so a missing binary never delays or breaks the session.
//
// A standard install under C:\piper needs no configuration. To override:
//   CLAUDE_TTS_PIPER   path to the Piper binary.
//   CLAUDE_TTS_VOICE   path to the .onnx voice model.
//   CLAUDE_TTS_PLAYER  raw-PCM player, default `ffplay`.
// With no Piper and no voice found, the hook stays silent.
//
// Touch the mute file (path from mutePath(), printed by `--where`) to shut it
// up mid-session; delete the file to resume.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TMP_PREFIX = 'claude-tts-';
const PID_FILE = path.join(os.tmpdir(), `${TMP_PREFIX}speak.pid`);
const MUTE_FILE = path.join(os.tmpdir(), `${TMP_PREFIX}mute`);
const TEXT_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_SAMPLE_RATE = 22050;

export const pidPath = () => PID_FILE;
export const mutePath = () => MUTE_FILE;

// Markdown reads badly aloud. Strip the syntax, keep the words, and replace
// code blocks with a count so you know something was skipped.
export function cleanForSpeech(markdown) {
  if (typeof markdown !== 'string') return '';
  let text = markdown;

  text = text.replaceAll(/<!--[\s\S]*?-->/g, '');

  // Fenced blocks become "code block, N lines" before any other rule runs.
  text = text.replaceAll(/^[ \t]*(?:```|~~~).*\n([\s\S]*?)^[ \t]*(?:```|~~~)[ \t]*$/gm, (_, body) => {
    const lines = body.replace(/\n$/, '').split('\n').length;
    return `code block, ${lines} ${lines === 1 ? 'line' : 'lines'}.`;
  });
  // An unterminated fence (a truncated reply) would otherwise be read verbatim.
  text = text.replace(/^[ \t]*(?:```|~~~)[\s\S]*$/m, 'code block.');

  const lines = [];
  for (let line of text.split(/\r?\n/)) {
    if (/^[ \t]*(?:[-*_][ \t]*){3,}$/.test(line)) continue;     // horizontal rule
    if (/^[ \t]*\|?[ \t]*:?-{2,}[-| :]*\|?[ \t]*$/.test(line)) continue; // table rule
    if (/^[ \t]*\|.*\|[ \t]*$/.test(line)) {
      line = line.replace(/^[ \t]*\|/, '').replace(/\|[ \t]*$/, '').split('|')
        .map((cell) => cell.trim()).filter(Boolean).join(', ');
    }
    line = line.replace(/^[ \t]*#{1,6}[ \t]+/, '');             // heading
    line = line.replace(/^[ \t]*>[ \t]?/, '');                  // blockquote
    line = line.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, '');  // list marker
    lines.push(line);
  }
  text = lines.join('\n');

  text = text.replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1');      // image
  text = text.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1');       // link
  text = text.replaceAll(/`+([^`]+)`+/g, '$1');                 // inline code
  text = text.replaceAll(/(\*\*|__)(.+?)\1/g, '$2');            // bold
  text = text.replaceAll(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1'); // italic

  text = text.replaceAll(/[ \t]+/g, ' ');
  text = text.replaceAll(/ *\n */g, '\n');
  text = text.replaceAll(/\n{2,}/g, '\n');
  return text.trim();
}

// Found without configuration, so a standard install needs no setup at all.
// The environment variables are an override, not a requirement.
const PIPER_DIRS = ['C:\\piper\\piper', 'C:\\piper', 'C:\\Program Files\\piper'];
const VOICE_DIRS = ['C:\\piper\\voices', 'C:\\piper'];

const firstExisting = (files) => files.find((file) => {
  try { return fs.statSync(file).isFile(); } catch { return false; }
});

export function findPiper(env = process.env) {
  if (env.CLAUDE_TTS_PIPER) return env.CLAUDE_TTS_PIPER;
  return firstExisting(PIPER_DIRS.map((dir) => path.join(dir, 'piper.exe')));
}

// Any voice beats no voice; alphabetical so the choice does not wander.
export function findVoice(env = process.env) {
  if (env.CLAUDE_TTS_VOICE) return env.CLAUDE_TTS_VOICE;
  for (const dir of VOICE_DIRS) {
    try {
      const models = fs.readdirSync(dir).filter((name) => name.endsWith('.onnx')).sort();
      if (models.length) return path.join(dir, models[0]);
    } catch {}
  }
  return undefined;
}

// Piper's voice config sits beside the model and carries its sample rate;
// guessing wrong makes the speech play at the wrong pitch.
export function sampleRateFor(voice) {
  for (const candidate of [`${voice}.json`, voice.replace(/\.onnx$/, '.onnx.json')]) {
    try {
      const rate = JSON.parse(fs.readFileSync(candidate, 'utf8'))?.audio?.sample_rate;
      if (Number.isFinite(rate) && rate > 0) return rate;
    } catch {}
  }
  return DEFAULT_SAMPLE_RATE;
}

const RUNNER = fileURLToPath(new URL('./speak-run.mjs', import.meta.url));

export function buildArgs({ piper, voice, player, textFile, rate }) {
  return [RUNNER, piper, voice, player, String(rate), textFile];
}

function killPrevious() {
  let pid;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()); } catch { return; }
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      // The runner is the parent of piper and the player; only /T reaches them.
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true }).unref();
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {}
}

function pruneTextFiles(dir) {
  const cutoff = Date.now() - TEXT_MAX_AGE_MS;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(TMP_PREFIX) || !name.endsWith('.txt')) continue;
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
      } catch {}
    }
  } catch {}
}

export function speak(text, env = process.env) {
  const piper = findPiper(env);
  const voice = findVoice(env);
  if (!piper || !voice) return false;
  if (fs.existsSync(MUTE_FILE)) return false;

  const clean = cleanForSpeech(text);
  if (!clean) return false;

  const dir = os.tmpdir();
  pruneTextFiles(dir);
  const textFile = path.join(dir, `${TMP_PREFIX}${Date.now()}-${process.pid}.txt`);
  fs.writeFileSync(textFile, clean, 'utf8');

  killPrevious();

  const args = buildArgs({
    piper,
    voice,
    player: env.CLAUDE_TTS_PLAYER || 'ffplay',
    textFile,
    rate: sampleRateFor(voice),
  });
  // Detached so the runner survives this process exiting a millisecond later.
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  try { fs.writeFileSync(PID_FILE, String(child.pid)); } catch {}
  return true;
}

export function handle(input, env = process.env) {
  // stop_hook_active means this Stop came from a hook-driven continuation.
  if (input?.stop_hook_active) return false;
  return speak(input?.last_assistant_message ?? '', env);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  if (process.argv[2] === '--where') {
    console.log(`mute file: ${MUTE_FILE}\npid file:  ${PID_FILE}`);
    process.exit(0);
  }
  let raw = '';
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try { handle(JSON.parse(raw)); } catch { /* Fail silent by design. */ }
    process.exit(0);
  });
}
