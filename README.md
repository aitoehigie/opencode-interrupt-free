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

## License

MIT
