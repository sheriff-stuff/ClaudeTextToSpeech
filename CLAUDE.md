# ClaudeTextToSpeech

Speaks Claude Code's AskUserQuestion prompts aloud. A PreToolUse hook posts the question text to `server.mjs`, which broadcasts it over SSE to a browser page that speaks it via `speechSynthesis`.

- Node 18+, no dependencies, no build. Port from `CLAUDE_TTS_PORT`, default 8765.
- Dev runs `node --watch server.mjs`: the server restarts on save, and the page reloads itself when its content hash (sent as an SSE `pagetag` event on connect) no longer matches.
- `server.mjs` — server plus embedded speaker page. `.claude/hooks/notify-question.mjs` — the hook.
- Everything fails silent: a missing server must never break a session.
- `node --test test.mjs` covers server, hook, and page (the page script runs in node:vm against stubbed browser globals). Run it after every change instead of asking the user to try the feature; only true audio quality needs human ears.
- `CONTEXT.md` holds the glossary; use its terms.
- `IDEAS.md` is local-only and gitignored — keep it out of commits.
- Never commit or push unless asked.
