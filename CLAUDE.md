# ClaudeTextToSpeech

Speaks Claude Code's AskUserQuestion prompts aloud. A PreToolUse hook posts the question text to `server.mjs`, which broadcasts it over SSE to a browser page that speaks it via `speechSynthesis`.

- Node 18+, no dependencies, no build. Port from `CLAUDE_TTS_PORT`, default 8765.
- `server.mjs` — server plus embedded speaker page. `.claude/hooks/notify-question.mjs` — the hook.
- Everything fails silent: a missing server must never break a session.
- `CONTEXT.md` holds the glossary; use its terms.
- `IDEAS.md` is local-only and gitignored — keep it out of commits.
- Never commit or push unless asked.
