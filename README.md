# hast-claude-mods

Claude Code mods by hastarin, published as one plugin marketplace.

| Mod | What it does |
| --- | --- |
| [usage-bar](usage-bar/README.md) | A coloured usage bar above the prompt: context fill, 5h/7d quota and cost, with optional git, model and prompt cache segments. |
| [repo-sync](repo-sync/README.md) | Fast-forwards the git repos you list at session start, and tells Claude when an instructions file such as `AGENTS.md` changed under it. |

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

## Layout

Each mod lives in its own folder with its own `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` at the root lists them all.
Run `claude plugin validate .` and `claude plugin test .` from inside a mod's folder.

## License

[MIT](LICENSE)
