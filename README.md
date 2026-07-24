# ClaudeTextToSpeech

Speaks Claude Code's questions aloud. A `PreToolUse` hook on the `AskUserQuestion` tool forwards the question text to a tiny local server, and a browser page speaks it via `speechSynthesis`. Only text ever crosses a machine boundary — synthesis and playback happen wherever the browser runs.

Built for the remote case: Claude Code on a Linux dev box (reached through Coder), you sitting at a Windows machine. The forwarded port carries the page and the event stream to your local browser. It also works trivially when everything is on one machine.

## Parts

| File | Runs where | Role |
| --- | --- | --- |
| `server.mjs` | where Claude Code runs | `POST /speak` → broadcast over SSE `GET /events`; `GET /` serves the speaker page. Node 18+, no deps. |
| `.claude/hooks/notify-question.mjs` | where Claude Code runs | Hook: extracts `tool_input.questions[].question`, POSTs the joined text, 1s timeout, always exits 0. |
| `.claude/settings.json` | project-level registration | `PreToolUse` hook with `"matcher": "AskUserQuestion"`. |

The port is `CLAUDE_TTS_PORT` (default 8765), read by both hook and server. The server binds `127.0.0.1` only.

## Behaviour

- Speaks the question text only — not headers, not answer options. Multiple questions in one call are joined.
- No replay: if no page is connected, the message is dropped. A question spoken minutes late is noise.
- Fail silent everywhere: server down → hook times out and exits 0; the question dialogue is unaffected.
- The page speaks inside the `EventSource` message handler, so it works from a background tab (network events wake tabs; timers are throttled).

## Setup

1. Start the server where Claude Code runs: `node server.mjs` (tmux, a spare terminal — your choice; a Coder startup script or systemd user unit also works, undocumented here on purpose).
2. Open `http://localhost:8765` in your browser. When remote, VS Code/Coder port forwarding gets you there — VS Code usually auto-forwards the port when it sees it listening.
3. Click **Enable sound** (browser autoplay policy requires one gesture; you'll hear "sound enabled").
4. Pin the tab and exempt it from tab discarding (Edge: site permissions → never put to sleep; Chrome: Memory Saver exceptions). Tab discard, not autoplay, is the main reliability risk.

Hook registration in this repo is project-level (`.claude/settings.json`), which is what you want while developing here. On the work dev box, register user-level instead so every repo speaks.

## Installing on a remote box

1. Copy `server.mjs` anywhere on the dev box (e.g. `~/claude-tts/server.mjs`).
2. Copy `.claude/hooks/notify-question.mjs` to `~/.claude/hooks/notify-question.mjs`.
3. Add to `~/.claude/settings.json` (merge into an existing `hooks` block if there is one):

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "AskUserQuestion",
           "hooks": [
             {
               "type": "command",
               "command": "node \"$HOME\"/.claude/hooks/notify-question.mjs",
               "timeout": 5
             }
           ]
         }
       ]
     }
   }
   ```

4. Start the server: `node ~/claude-tts/server.mjs`.
5. Hook config is snapshotted at session start — run `/hooks` or start a new session to pick it up.
6. Open `http://localhost:8765` in your local browser (via the forwarded port), click **Enable sound**, pin the tab, exempt it from tab discarding.
7. Verify with the `curl` command below, then with a real question.

## Verifying

With the server running and the page's sound enabled:

```sh
curl -s -X POST --data "Testing one two three" http://localhost:8765/speak
```

You should hear it. Then ask Claude Code something that makes it use AskUserQuestion and hear the real thing.

## Non-goals

- Speaking ordinary responses or Notification events (permission prompts) — the latter could be added later on the same pipeline.
- Cloud TTS.
- The VS Code extension version — separate idea, separate doc.
