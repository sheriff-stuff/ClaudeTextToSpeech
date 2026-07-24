# CONTEXT

Glossary for ClaudeTextToSpeech. Terms only — no implementation details.

## Terms

**Question** — the text of a single question Claude Code puts to the user via its AskUserQuestion tool. The spoken unit of this system. Only the question text is spoken — never its header or answer options.

**Hook** — the script Claude Code runs on the dev box just before an AskUserQuestion dialogue appears. It forwards the question to the Question Server and must never delay or break the session, even when the server is absent.

**Question Server** — the process on the dev box that receives questions from the Hook and broadcasts them to connected Speaker Pages. It holds no history: a question with no listener is dropped.

**Speaker Page** — the browser page on the local machine that listens to the Question Server and speaks each question aloud through the local OS speech engine.

**Enable-sound gesture** — the one click the Speaker Page requires before it is allowed to produce audio; after it, the page may speak indefinitely.

**Dev box** — the remote Linux machine where the Claude Code session, Hook, and Question Server run.

**Local machine** — the Windows machine the user sits at, where the Speaker Page runs and audio plays. The only link between the two machines is a forwarded port.
