# ClaudeTextToSpeech

Speaks Claude Code's replies aloud. A `Stop` hook fires when a reply finishes, cleans the markdown for the ear, and pipes it through [Piper](https://github.com/rhasspy/piper) into a player. Local synthesis, no network, no browser, no account.

Windows, Node 18+, no dependencies, no build.

## Parts

| File | Role |
| --- | --- |
| `.claude/hooks/speak-reply.mjs` | The hook. Cleans `last_assistant_message`, kills any playback still running, starts the pipeline, exits 0. |
| `.claude/hooks/speak-run.mjs` | The pipeline. Feeds the text to Piper and pipes its raw PCM into the player. Outlives the hook. |
| `.claude/settings.json` | Registers the `Stop` hook for this repo. |
| `test.mjs` | `node --test test.mjs`. Cleaner, payload handling, and the real spawned pipeline against stub binaries. |
| `smoke.mjs` | `node smoke.mjs`. Speaks a sample through the real Piper, for the part only ears can judge. |

## Setup

1. Download `piper_windows_amd64.zip` from the [Piper releases](https://github.com/rhasspy/piper/releases) and unzip it to `C:\piper`.
2. Download a voice into the `voices` folder there: `en_GB-alba-medium.onnx` and its `.onnx.json` config, from [the voice list](https://rhasspy.github.io/piper-samples/). Both files. The config carries the sample rate; without it the speech plays at the wrong pitch.
3. Make sure `ffplay` (part of ffmpeg) is on `PATH`.
4. Run `/hooks` or start a new session, so the hook registration is picked up.

That is the whole setup. Nothing to configure: the hook looks under `C:\piper` and uses what it finds, picking the first voice alphabetically when there are several. Check it with `node smoke.mjs`, which prints what it found before making any noise.

Environment variables override discovery, for an install somewhere else:

| Variable | Meaning |
| --- | --- |
| `CLAUDE_TTS_PIPER` | Path to the Piper binary. |
| `CLAUDE_TTS_VOICE` | Path to the `.onnx` voice model. |
| `CLAUDE_TTS_PLAYER` | Raw-PCM player, default `ffplay`. |

With no Piper and no voice found, the hook stays silent.

## Behaviour

- Speaks the final reply of a turn. Subagents fire `SubagentStop`, a different event, so they stay silent.
- Markdown is cleaned first: headings, bullets, links and emphasis lose their syntax; a fenced block becomes "code block, twelve lines"; a table row is read as a sentence.
- Replies are spoken in full, however long. A new reply interrupts whatever is still playing.
- Fail silent everywhere: no Piper, no voice, no player, bad payload — the hook exits 0 and the session never notices.

## Turning it off

Create the mute file and the hook stays quiet; delete it to resume. Both work mid-session, no restart.

```sh
node .claude/hooks/speak-reply.mjs --where   # prints the mute and pid file paths
```

To silence just the reply currently playing, kill the player.

## Every repo, not just this one

Registration here is project-level, which is what you want while working on this repo. To have every session speak, put the same block in `~/.claude/settings.json` and point it at a copy of the two hook files:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME\"/.claude/hooks/speak-reply.mjs",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

`speak-run.mjs` must sit beside `speak-reply.mjs`; the hook finds it by relative path.

## Non-goals

- Speaking questions, permission prompts, or anything mid-turn.
- Cloud TTS.
- Summarizing the reply rather than reading it.
