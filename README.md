# Local AI Next Edit

Local, diagnostic-aware code correction for Visual Studio Code, powered by the Ollama model you already have loaded.

Continue can keep handling ordinary FIM autocomplete. Local AI Next Edit handles small rewrites of existing code—using the same `qwen2.5-coder:1.5b` model, the same **Tab** key, and no cloud API.

```text
Ordinary completion                  Existing-code correction
VS Code → Continue → Ollama          VS Code → Local AI Next Edit → Ollama
                       └──────── same qwen2.5-coder:1.5b ────────┘
```

## What it fixes

When you have just edited a line and VS Code reports a nearby error or warning, the extension can suggest a minimal replacement:

```diff
- inport numpy as np
+ import numpy as np

- import nimpy as np
+ import numpy as np

- pritn("hello")
+ print("hello")

- pkt.show()
+ plt.show()
```

Press **Tab** to accept a correction or **Esc** to dismiss it. A pending correction takes priority over normal completion; when no correction is ready, Tab continues to accept Continue's suggestion normally.

## Features

- Rewrites existing code instead of asking a FIM model to fill only at the cursor.
- Uses VS Code diagnostics, the latest edit, and a small amount of nearby context.
- Gives spelling corrections priority over ordinary autocomplete.
- Debounces requests and cancels stale work as soon as typing continues.
- Limits automatic edits to a small region and rejects unchanged, unsafe, or oversized output.
- Fast-paths clear local identifier typos such as `pkt.show()` → `plt.show()` when surrounding code strongly supports `plt`.
- Shows an inline replacement preview and also exposes **Apply Local AI rewrite** as a Quick Fix.
- Uses only stable VS Code APIs—no proposed API flags.
- Never applies an AI edit without your confirmation.

## Requirements

- Visual Studio Code `1.136.0` or newer
- Ollama running locally at `http://localhost:11434`
- `qwen2.5-coder:1.5b` already installed:

```powershell
ollama pull qwen2.5-coder:1.5b
```

For Python, install and enable a diagnostic provider such as Pylance. The automatic safety gate intentionally requires an Error or Warning near a recent edit.

## Install

Download the `.vsix` from the [latest GitHub release](https://github.com/Morgan-Ruijie/local-ai-next-edit/releases/latest), then in VS Code:

1. Open the Extensions view.
2. Open the `...` menu.
3. Choose **Install from VSIX...** and select the downloaded file.

You can also install it from a terminal:

```powershell
code --install-extension local-ai-next-edit-0.1.1.vsix
```

Reload VS Code after installation.

## Configuration

Defaults:

```json
{
  "localNextEdit.enabled": true,
  "localNextEdit.ollamaUrl": "http://localhost:11434",
  "localNextEdit.model": "qwen2.5-coder:1.5b",
  "localNextEdit.debounceMs": 400,
  "localNextEdit.maxEditLines": 3,
  "localNextEdit.showInlinePreview": true,
  "localNextEdit.keepAlive": "30m"
}
```

Only loopback Ollama addresses (`localhost`, `127.0.0.1`, and `::1`) are accepted. No API key is needed.

## How the safety gate works

Automatic correction runs only when all of these are true:

- the feature is enabled;
- the current file is not excluded;
- the user recently changed text near the cursor;
- an Error or Warning diagnostic is close to that edit;
- typing has stopped for the configured debounce period;
- the replacement is different, small, and structurally plausible.

This gate prevents a small local model from continuously second-guessing valid code. It also keeps Ollama available for fast Continue autocomplete instead of sending a rewrite request on every keystroke.

To retry deliberately, run **Local Next Edit: Check Current Diagnostic** from the Command Palette. Request and filter decisions appear in the **Local AI Next Edit** output channel.

## Continue coexistence

This extension does not read or change Continue's configuration. VS Code can query multiple inline-completion providers; Local AI Next Edit returns nothing unless its diagnostic gate is satisfied. Continue remains responsible for normal FIM autocomplete.

Both extensions can reuse Ollama's one loaded `qwen2.5-coder:1.5b` model. The default `keepAlive` value helps avoid unloading it between requests. GitHub Copilot is not required.

## Privacy and security

- Requests go directly from VS Code to your loopback Ollama server.
- No cloud model, telemetry service, API key, or remote project indexing is used.
- Only the editable line, diagnostic text, and limited nearby context are sent.
- The extension refuses non-loopback Ollama URLs.
- Suggestions require explicit acceptance before a file changes.

## Current limitations

- The MVP is tuned and tested primarily for Python, although the implementation is language-agnostic.
- Automatic correction depends on diagnostics from your installed language tooling.
- Stable inline replacement behavior is most reliable for a single line, so multi-line model output is currently rejected even though `maxEditLines` is reserved for future support.
- Small models can still decline a valid correction or produce a poor candidate; the safety filter favors missed suggestions over speculative edits.

## Development

```powershell
npm ci
npm test
npm run package
```

`npm test` compiles the TypeScript source and runs the unit suite. `npm run test:ollama` performs optional live checks against the local Ollama instance.

## Roadmap

- Better ranking when several diagnostics overlap
- More language-specific deterministic spelling fast paths
- Richer multi-line inline edits when stable VS Code APIs support them reliably
- Lightweight feedback controls for accepted and rejected candidates

## License

[MIT](LICENSE)


