// node smoke.mjs ["something to say"]
//
// The one thing node --test cannot check: whether it actually sounds right.
// Speaks a sample through the real Piper and the real player, using the same
// path a Stop hook takes. Reports what it found before making any noise.

import fs from 'node:fs';
import {
  cleanForSpeech, findPiper, findVoice, mutePath, speak,
} from './.claude/hooks/speak-reply.mjs';

const SAMPLE = `## Done

Fixed the parser bug in \`server.mjs\`, two files changed.

\`\`\`js
const answer = 42;
const other = 43;
\`\`\`

Tests pass. See [the docs](http://example.com) for the **details**.`;

const text = process.argv[2] || SAMPLE;
const piper = findPiper();
const voice = findVoice();
const player = process.env.CLAUDE_TTS_PLAYER || 'ffplay';

console.log(`piper:  ${piper || '(not found)'}`);
console.log(`voice:  ${voice || '(not found)'}`);
console.log(`player: ${player}`);

if (!piper || !voice) {
  console.error('\nNothing spoken. Install Piper and a voice under C:\\piper, or set'
    + ' CLAUDE_TTS_PIPER and CLAUDE_TTS_VOICE.');
  process.exit(1);
}
if (fs.existsSync(mutePath())) {
  console.error(`\nMuted by ${mutePath()} — delete it to hear anything.`);
  process.exit(1);
}

console.log(`\nspeaking:\n${cleanForSpeech(text)}\n`);
speak(text);
