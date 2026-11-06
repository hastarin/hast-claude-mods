# settings-sync

A Claude Code mod that merges a shared settings file into each machine's own `~/.claude/settings.json` when a session starts.
It is for settings you want the same everywhere, kept in a git repo you already sync across machines, while each machine keeps its own hooks, paths and anything else only it needs.

Keep `settings.json` itself out of git: Claude Code writes to it, parts of it only make sense on one machine, and it can hold secrets.
Put only the shared part in the shared file, and never put a key, token or password in it.

## What the merge does

| In the shared file | What happens on this machine |
| --- | --- |
| A value, such as `"model": "sonnet"` | It replaces this machine's value, so a change made once reaches every machine. |
| An object, such as `permissions` or `pluginConfigs` | It is merged key by key, so keys only this machine has stay. |
| A list, such as `permissions.allow` or a hook event | Its entries are added after this machine's own, skipping any already there. |
| A list entry you take out of it, such as a permission rule | It is taken out on each machine at its next session. |
| A setting you take out of it | Each machine keeps the value it has, and the setting is no longer synced. |
| Nothing about a key | This machine's value is left alone. |

The mod remembers what it last applied on each machine, which is how it knows what you took out.
It writes `settings.json` only when something changed, saves the old file as `settings.json.settings-sync.bak` first, and shows a toast naming the settings it changed.
It never writes over a `settings.json` it cannot read, or when the shared file is missing or broken; the toast says why instead.

Because a shared value wins, changing that setting on one machine (with `/model`, say) lasts only until the next session there.
Change it in the shared file instead, or take it out of the shared file to let each machine choose; each keeps the value it had.

Claude Code picks up most changes to `settings.json` straight away.
Some settings, such as `model` and `env`, apply from the next session.

## Checking what it did

Toasts show in a terminal session.
The desktop app and other surfaces that drive Claude Code for you may not show them.

- `/settings-sync status` says when the last sync ran and what it changed, on any surface.
- `/settings-sync now` syncs again straight away, such as after pulling a change to the shared file, and says what it did.

## Install

At the prompt of a terminal session:

```text
/plugin install settings-sync --marketplace hastarin/hast-claude-mods
```

From a shell:

```shell
claude plugin install settings-sync --marketplace hastarin/hast-claude-mods
```

New versions arrive only if you turn on auto-update for the marketplace, or update by hand; see [Updates](../README.md#updates).

## Settings

The mod does nothing until you name the shared file.
Set it in the config menu, or in `~/.claude/settings.json` on each machine:

```json
{
  "pluginConfigs": {
    "settings-sync@hast-claude-mods": {
      "options": { "file": "~/.agents/claude/settings.json" }
    }
  }
}
```

| Option | Default | What it does |
| --- | --- | --- |
| `file` | empty | The shared settings file, written like `settings.json`. `~` means your home folder. |
| `skip` | empty | Settings this machine leaves alone, separated by commas, such as `env, hooks`. A dot reaches inside a setting, as in `pluginConfigs.usage-bar@hast-claude-mods`. |

The shared file is plain JSON, and may start with a `$schema` line for your editor:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "env": { "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet" },
  "permissions": { "allow": ["Bash(npx -y gh-axi)"] }
}
```

A skipped setting is never written on that machine, never taken out there, and not listed by `/settings-sync`.
Use it on a machine that needs its own value for something the shared file sets, and for settings you mean to keep on one machine, so the report leaves them out.
Skipping a key reaches every key inside it, and a key whose name has a dot in it cannot be named on its own.

With [repo-sync](../repo-sync/README.md) pulling the same repo, a change pushed from one machine reaches the others at their next session or the one after, depending on whether the pull finishes before this mod reads the file.

`settings.json` lives in `CLAUDE_CONFIG_DIR` when that is set.

## Sharing a setting from this machine

Nothing goes back into the shared file by itself.
Changes you make in Claude Code, such as `/model`, `/config`, installing a plugin or answering "always allow" to a permission prompt, go to this machine's `settings.json` only.

Run `/settings-sync` to see what this machine has that the shared file lacks:

```text
This machine's settings.json against ~/.agents/claude/settings.json
Set differently here (the shared value comes back at the next session):
  1. theme: "light" (shared: "dark")
Only on this machine:
  2. permissions.allow: + "Bash(npm test)"
  3. voice.enabled: false
Run /settings-sync add <numbers> (such as /settings-sync add 2) to copy items into the shared file, then commit and push it.
```

Then `/settings-sync add 2 3` copies those items into the shared file: a value is set there, and a list entry is added to the list.
The numbers are the ones from the last report, and `add` refuses if either file has changed since; run `/settings-sync` again for new numbers.
It writes only the shared file, and never commits or pushes it, so you can check the change before it goes anywhere.
It refuses an `env` variable whose name looks like a secret (`TOKEN`, `SECRET`, `PASSWORD`, `API_KEY` and so on).
Claude sees the report too, so you can ask it to help choose what to share.

## Development

From this folder (`settings-sync/`):

```shell
claude plugin validate .
claude plugin test .
```

## License

[MIT](../LICENSE)
