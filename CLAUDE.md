# ClaudeTextToSpeech

Speaks Claude Code's replies aloud. A `Stop` hook cleans `last_assistant_message`, then Piper synthesizes it locally and a player plays it.

- Windows only, Node 18+, no dependencies, no build. Everything runs on the one machine.
- `.claude/hooks/speak-reply.mjs` — the hook. `.claude/hooks/speak-run.mjs` — the detached pipeline it starts. They must stay in the same directory.
- No configuration in the normal case: Piper and the voice are discovered under `C:\piper`. `CLAUDE_TTS_PIPER`, `CLAUDE_TTS_VOICE` and `CLAUDE_TTS_PLAYER` override that. Keep it this way; config that has to be installed twice is config that goes stale.
- Everything fails silent: a missing binary must never break a session, and the hook must never wait for audio.
- Windows pipeline gotcha, learned the hard way: a non-detached child dies when the hook exits, and a detached `cmd.exe` gets a fresh console whose pipes never connect. Hence the detached Node runner doing its own piping. Don't rewrite it as a shell one-liner.
- `node --test test.mjs` covers the cleaner, payload handling, and the real spawned pipeline against stub binaries. Run it after every change instead of asking the user to try the feature; only true audio quality needs human ears, via `node smoke.mjs`.
- `CONTEXT.md` holds the glossary; use its terms.
- `IDEAS.md` is local-only and gitignored — keep it out of commits.
- Never commit or push unless asked.
