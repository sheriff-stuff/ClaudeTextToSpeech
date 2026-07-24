// PreToolUse hook for AskUserQuestion — forwards the question text to the
// Question Server. Fire-and-forget: short timeout, always exits 0, so a
// missing server never blocks or breaks the session.

const PORT = Number(process.env.CLAUDE_TTS_PORT) || 8765;

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const input = JSON.parse(raw);
    const questions = input?.tool_input?.questions ?? [];
    const text = questions
      .map((q) => q?.question)
      .filter(Boolean)
      .join(' … ');
    if (text) {
      await fetch(`http://127.0.0.1:${PORT}/speak`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: text,
        signal: AbortSignal.timeout(1000),
      });
    }
  } catch {
    // Fail silent by design.
  }
  process.exit(0);
});
