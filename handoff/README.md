# handoff

A Claude Code mod that compacts a long session, or hands it off to a new one, in one click.
Once the context passes a threshold (200k tokens by default), buttons appear above the prompt.
They stay hidden while Claude is working.

Each summary is written by Claude Code's own `/compact`, so it keeps up with any changes Anthropic makes to it.
Each one is also saved as a file in `~/.claude/handoffs/`, named after the session and the time.
Saved summaries are deleted after 30 days by default; see `keepFor` under [Settings](#settings).

## The buttons

| Button | Where | What it does |
| --- | --- | --- |
| Compact | everywhere | Compacts this session, and saves the summary. |
| New session | terminal, VS Code | Compacts this session, saves the summary, clears, then sends the summary as the new session's first message. |
| New session | desktop app | Compacts this session, saves the summary, and puts a request in the prompt box for Claude to start a new session from it. Press Enter to send it. |

The new session reads the handoff, says in one line where things stand, and waits for your go-ahead.

The old session is never lost.
In the terminal it is listed by `claude --resume`, and in VS Code it stays in the session history.
The desktop app is different: there a clear makes the sidebar entry show the new session, and the old conversation cannot be opened again from the app.
That is why New session in the desktop app asks Claude to start a separate session instead of clearing this one.

If any step fails, such as an empty summary or a file that cannot be saved, the mod stops before clearing anything and a toast says why.

## The command

`/handoff` does the same at any context size:

- `/handoff compact [note]` compacts now.
- `/handoff new [note]` starts a new session; in the desktop app it asks Claude to start one.
- `/handoff copy [note]` copies the handoff, to paste into a new session yourself or take somewhere else.
- `/handoff` on its own lists these and says how full the context is.

A note tells the summary what to focus on, as it would after `/compact`, and is saved with the summary, such as `/handoff new focus on the failing test`.

If another mod or a skill already uses `/handoff`, the mod takes `/hast-handoff` instead and a toast says so.

## Install

At the prompt of a terminal session:

```text
/plugin install handoff --marketplace hastarin/hast-claude-mods
```

From a shell:

```shell
claude plugin install handoff --marketplace hastarin/hast-claude-mods
```

New versions arrive only if you turn on auto-update for the marketplace, or update by hand; see [Updates](../README.md#updates).

## Settings

Change these in the config menu, or under `pluginConfigs` in `~/.claude/settings.json`:

| Setting | Default | What it does |
| --- | --- | --- |
| `thresholdK` | 200 | The buttons appear from this many thousand tokens. Enter 0 to go back to 200. |
| `compactFirst` | on | New session compacts the old one first, so resuming it later loads from the summary. Turned off, the summary is written without changing the old session. |
| `keepFor` | 30 days | Saved summaries older than this are deleted when a session starts: Never, 1, 2, 7, 14 or 30 days. Only files the mod saved are deleted, so other files in the folder are safe. |
| `folder` | `~/.claude/handoffs` | Where the summaries are saved. |

```json
{
  "pluginConfigs": {
    "handoff@hast-claude-mods": {
      "options": { "thresholdK": 150, "folder": "~/notes/handoffs" }
    }
  }
}
```

## Steering every summary

To change what every summary keeps, add a `# Compact instructions` section to your `CLAUDE.md`.
Claude Code reads it on every compaction, including plain `/compact` and auto-compact, not just this mod's.
See [Manage context proactively](https://code.claude.com/docs/en/costs#manage-context-proactively) in the Claude Code docs.

With **New session: compact the old one first** turned off, the summary is written without `/compact`.
The mod then asks for a handoff of its own: what was done and what is next, decisions and constraints, files touched, open questions, and your own messages that still matter.

## Good to know

- In the desktop app and VS Code the mod runs `/compact` for you, so it shows in the conversation as a command from the mod, with your note when you give one.
- The summaries can hold anything the conversation did, so treat the handoffs folder as you would the transcripts themselves.
- The mod has no skill: Claude never compacts or clears a session on its own through it.
