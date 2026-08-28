// The pipeline that outlives the hook: feeds the prepared text to Piper and
// pipes its raw PCM straight into the player, so speech starts on the first
// sentence instead of after the whole reply is synthesized.
//
//   node speak-run.mjs <piper> <voice> <player> <sampleRate> <textFile>
//
// The hook spawns this detached and exits. Node does the piping rather than a
// shell: a detached cmd.exe gets a fresh console and its pipes never connect.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// No channel count: ffplay rejects `-ac` outright ("Option not found") and
// dies before playing a byte, and the s16le demuxer assumes mono anyway,
// which is what every Piper voice produces. test.mjs checks these against the
// real player, because a stub will accept anything.
export const playerArgs = (rate) => [
  '-f', 's16le', '-ar', String(rate),
  '-nodisp', '-autoexit', '-loglevel', 'quiet', '-i', '-',
];

// A .cmd or .bat wrapper is a reasonable thing to point at, and Node refuses
// to spawn one without a shell.
const needsShell = (file) => /\.(?:cmd|bat)$/i.test(file);

export function run([piperPath, voice, playerPath, rate, textFile]) {
  const piper = spawn(piperPath, ['--model', voice, '--output_raw'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    shell: needsShell(piperPath),
  });

  const player = spawn(playerPath, playerArgs(rate), {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
    shell: needsShell(playerPath),
  });

  // A dead player or a dead Piper must not raise; the session is long gone.
  const quit = () => {
    try { fs.unlinkSync(textFile); } catch {}
    process.exit(0);
  };
  for (const stream of [piper.stdin, piper.stdout, player.stdin]) stream.on('error', () => {});
  piper.on('error', quit);
  player.on('error', quit);
  player.on('exit', quit);

  piper.stdout.pipe(player.stdin);
  fs.createReadStream(textFile).on('error', quit).pipe(piper.stdin);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2));
}
