# usage-bar

A Claude Code mod that draws a coloured usage bar above the prompt, on any surface you turn it on for.

```text
usage-bar-mod main ?1  |  Opus 5.5 [high]  [█░░░░░░░░░░░░░░░░░░░] 5%  54k / 1M  5h 56% (2h) · 7d 25% (4d)  cache (50m)  ~$0.21
```

From left to right, the bar shows:

- The git repository, branch and working tree state, if turned on.
- The model and effort level, if turned on.
- Context window fill, as a bar, a percentage and a token count.
- Quota used in the 5-hour and 7-day windows, with the time until each resets.
- A countdown to when the prompt cache expires, if turned on.
- The session's cost, plus the amount charged to credits once a quota window reaches 100%.

## Install

At the prompt of a terminal session:

```text
/plugin install usage-bar --marketplace hastarin/usage-bar-mod
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```shell
claude plugin install usage-bar --marketplace hastarin/usage-bar-mod
```

In the desktop app, where `/plugin` does not run, click + next to the prompt box, then Plugins, Add marketplace with `hastarin/usage-bar-mod`, then Add plugin.

## Usage

The bar appears by itself on the desktop app and in VS Code.
Run `/usage-bar` on any surface to print the whole line as plain text, with every segment it has a reading for.

## Settings

Each environment has its own settings in `/config`, which apply as soon as you change them:

| Environment | Bar | Git | Cache | Model |
| ----------- | --- | --- | ----- | ----- |
| Terminal    | On  | On  | On    | On    |
| VS Code     | On  | Off | Off   | Off   |
| Desktop     | On  | On  | On    | Off   |

The table shows the defaults.
A segment needs the bar on for its environment as well as its own setting.
The mobile app follows the desktop settings.

Settings are stored per install, so each computer keeps its own.

## How the live segments work

The band redraws by itself only when something it shows changes, so an idle session does no drawing between changes.

Context, quota and cost update after each response, including partway through a turn.

Git runs in the background, after each reply and about once a minute when idle, and the band draws its last result.
It never holds up the prompt, and it only runs while a surface is showing it.

The cache countdown starts when a main-conversation request is sent, and counts in whole minutes.
Subagents do not touch it, because their requests carry a prefix of their own.
Keep-alive pings made through `$.model.fork`, such as those from `cache-keepalive`, restart it.

The API does not tell a mod the cache's lifetime, so the mod works it out in the engine's order: `FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H`, then one hour on a subscription under its limits and five minutes otherwise.
It then corrects that from what requests prove.
A full rewrite too soon for an hour means five minutes, and a cache hit too late for five minutes means an hour.

The countdown has these limits:

- It stays blank after `--resume` until the first reply.
- Effort and a `/model` drop show only after the next reply.
- It cannot see the server renewing the cache by any other route.

## Terminal status line

[`statusline/statusline.ps1`](statusline/statusline.ps1) draws the same line as the terminal's status line.

The script is not part of the plugin, so installing the mod does not set it up.
The mod shows all of this in the terminal too, so with both set up you see the two side by side.
To keep only the script, turn off the terminal bar in `/config`.
It needs [PowerShell 7](https://github.com/PowerShell/PowerShell) (`pwsh`) and, for the git details, `git`.

To use it, clone this repository and add the following to `~/.claude/settings.json`, adjusting the path to match your clone:

```json
{
  "statusLine": {
    "type": "command",
    "command": "pwsh -NoProfile -NonInteractive -File ~/source/usage-bar-mod/statusline/statusline.ps1",
    "refreshInterval": 60
  }
}
```

`refreshInterval` keeps the reset times and the cache countdown moving while the session is idle.

## Colours

Context fill is coloured by level: green, then amber at 50%, orange at 75%, red at 90% and gold at 100%.

Each quota window is coloured by pace rather than level, based on where the window will land at its reset if usage continues at the same rate:

| Projected use at reset | Colour |
| ---------------------- | ------ |
| Up to 100%             | Green  |
| Up to 125%             | Amber  |
| Up to 150%             | Orange |
| Over 150%              | Red    |

Under 25% used, the projection is too noisy to trust, so the window stays green.
From 90% used, the window is coloured by level, whatever the pace.
A window with no usable reset time is also coloured by level.

## Development

```shell
claude plugin validate .
claude plugin test .
```

## License

[MIT](LICENSE)

The cache countdown adapts code and ideas from [`cache-timer`](https://github.com/arasovic/claude-code-mods) by Mehmet Aras and [`cache-keeper`](https://github.com/nateherkai/claude-code-mods) by Nate Herk, both MIT licensed.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
