# opencode-plugin-interrupt

Makes OpenCode interruption-aware.

When you hit Ctrl+C mid-response and type a correction, the AI knows it was
interrupted, knows what it was saying, and responds to your correction directly
instead of treating it as a fresh message.

## Install

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-plugin-interrupt"]
}
```

That's it. No API keys. No configuration required.

## Voice mode

Install `speech-opencode` and `opencode-voice` alongside this plugin for full
voice interruption support. The plugin auto-detects when voice plugins are present.

```json
{
  "plugin": [
    "speech-opencode",
    "opencode-voice",
    "opencode-plugin-interrupt"
  ]
}
```

## How it works

**Text mode (default):**
1. Model streams a response
2. You hit Ctrl+C
3. You type a correction ("no, I meant X" / "wait, actually...")
4. The plugin injects context: what the model was saying + your correction
5. Model responds directly to the correction

**Voice mode (with speech-opencode):**
Same flow, but interruption is detected by voice timing patterns.

## Configuration

```json
{
  "plugin": [
    ["opencode-plugin-interrupt", {
      "sensitivity": "medium",
      "debug": false,
      "correctionTriggers": ["my bad", "scratch that"]
    }]
  ]
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `sensitivity` | `"medium"` | `"low"`, `"medium"`, or `"high"` |
| `timingWindowMs` | `5000` | MS window after response to detect corrections |
| `maxCorrectionLength` | `120` | Max chars for a message to be a correction candidate |
| `correctionTriggers` | `[]` | Extra trigger words beyond built-in list |
| `debug` | `false` | Log interruption events to console |
| `voiceMode` | `"auto"` | `"auto"`, `"enabled"`, or `"disabled"` |

## Why this exists

Current AI CLI tools treat Ctrl+C as a discard. Context is lost. The model
on the next turn has no idea what it was saying. This plugin fixes that by
making the interruption itself a meaningful signal.

MIT License
