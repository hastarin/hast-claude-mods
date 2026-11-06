# hast-claude-mods

Claude Code mods by hastarin, published as one plugin marketplace.

| Mod | What it does |
| --- | --- |
| [usage-bar](usage-bar/README.md) | A coloured usage bar above the prompt: context fill, 5h/7d quota and cost, with optional git, model and prompt cache segments. |
| [repo-sync](repo-sync/README.md) | Fast-forwards the git repos you list at session start, and tells Claude when an instructions file such as `AGENTS.md` changed under it. |
| [settings-sync](settings-sync/README.md) | Merges a shared settings file, such as one in a synced git repo, into each machine's `settings.json` at session start, keeping each machine's own settings. |
| [handoff](handoff/README.md) | Once the context gets long, buttons above the prompt compact the session or hand it off to a new one in one click, with each summary saved to disk. |

## Install

At the prompt of a terminal session, replacing `<mod>` with a name from the table:

```text
/plugin install <mod> --marketplace hastarin/hast-claude-mods
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```shell
claude plugin install <mod> --marketplace hastarin/hast-claude-mods
```

In the desktop app, where `/plugin` does not run, click + next to the prompt box, then Plugins, Add marketplace with `hastarin/hast-claude-mods`, then Add plugin.

## Updates

Claude Code does not update mods from this marketplace by itself until you turn auto-update on for it.
In a terminal session, run `/plugin`, open Marketplaces, choose `hast-claude-mods` and turn on Enable auto-update.
Claude Code then checks for new versions during each session and asks you to run `/reload-plugins` when one is installed.

To update by hand instead:

```shell
claude plugin update <mod>@hast-claude-mods
```

## Layout

Each mod lives in its own folder with its own `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` at the root lists them all.
Run `claude plugin validate .` and `claude plugin test .` from inside a mod's folder.

## License

[MIT](LICENSE)
