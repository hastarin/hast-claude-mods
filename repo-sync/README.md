# repo-sync

A Claude Code mod that fast-forwards the git repos you list each time a session starts.
It is for repos you keep on several machines, such as your `AGENTS.md` or `CLAUDE.md`, skills or dotfiles.

When a session starts, the mod runs `git pull --ff-only` in each repo, without waiting for it to finish.
It never merges, rebases or forces.

| What happened | What you see | What Claude is told |
| --- | --- | --- |
| Already current | Nothing | Nothing |
| Pulled new commits | A toast: `~/.agents updated 29d9636..9ee3d3b` | Nothing, unless a watched file changed |
| A watched file changed (`AGENTS.md`, `CLAUDE.md` by default) | The same toast | That the file changed and the copy it loaded may be stale, so it should re-read it |
| The pull failed (offline, diverged history, local changes in the way) | A toast with git's reason | That the repo could not be pulled, so files from it may be out of date |
| Local commits not pushed yet | A toast with the count | The count, so it can remind you |
| Another session is pulling the same repo | Nothing | Nothing |

Claude Code may load `AGENTS.md` or `CLAUDE.md` before the pull finishes.
So instead of relying on load order, the mod adds its note to the system prompt, and the first prompt waits for the pulls to finish (at most the timeout).

## Install

At the prompt of a terminal session:

```text
/plugin install repo-sync --marketplace hastarin/hast-claude-mods
```

From a shell:

```shell
claude plugin install repo-sync --marketplace hastarin/hast-claude-mods
```

New versions arrive only if you turn on auto-update for the marketplace, or update by hand; see [Updates](../README.md#updates).

## Settings

The mod does nothing until you list at least one repo.
Set its options in the config menu, or in `~/.claude/settings.json` on each machine:

```json
"pluginConfigs": {
  "repo-sync@hast-claude-mods": {
    "options": {
      "repos": "~/.agents, ~/dotfiles",
      "watch": "AGENTS.md, CLAUDE.md",
      "timeoutSeconds": 20
    }
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `repos` | empty | Folders to pull, separated by commas. `~` is your home folder (`HOME`, or `USERPROFILE` on Windows). |
| `watch` | `AGENTS.md, CLAUDE.md` | File names that mean "re-read": a change to one in any folder of a repo is pointed out to Claude. |
| `timeoutSeconds` | `20` | How long each pull may take; the first prompt waits at most this long. |

Git runs directly, with no shell, so the mod works the same on Windows, Linux and macOS.
A pull that would ask for credentials fails instead of waiting for input.

## Development

From this folder (`repo-sync/`):

```shell
claude plugin validate .
claude plugin test .
```

## License

[MIT](../LICENSE)
