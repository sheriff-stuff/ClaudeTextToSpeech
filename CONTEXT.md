# CONTEXT

Glossary for ClaudeTextToSpeech. Terms only — no implementation details.

## Terms

**Reply** — the text Claude Code puts on screen when it finishes a turn and hands control back to you. The spoken unit of this system.

**Hook** — the script Claude Code runs when a reply finishes. It cleans the reply and starts the Pipeline, then gets out of the way. It must never delay or break the session, even when nothing is installed.

**Pipeline** — the pair of processes that turn cleaned text into sound: the synthesizer feeding the player. It outlives the Hook and keeps talking after the session has moved on.

**Synthesizer** — Piper, running locally from a binary and a voice model. No network, no account, no cloud.

**Player** — the process that turns the synthesizer's raw audio into sound on the speakers.

**Cleaning** — rewriting a reply for the ear: markdown syntax removed, code blocks replaced by a count of their lines.

**Interrupt** — what happens when a reply finishes while the previous one is still being spoken: the older Pipeline is killed and the new reply starts immediately.

**Mute file** — the file whose existence silences the Hook. Create it to shut the system up mid-session, delete it to resume.
