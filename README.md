# usage-bar

A Claude Code mod that draws a coloured usage bar above the prompt on surfaces with no `statusLine`, such as the desktop app and VS Code.

```text
[█░░░░░░░░░░░░░░░░░░░] 5%  54k / 1M  5h 56% (2h) · 7d 25% (4d)  ~$0.21
```

From left to right, the bar shows:

- Context window fill, as a bar, a percentage and a token count.
- Quota used in the 5-hour and 7-day windows, with the time until each resets.
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
Run `/usage-bar` on any surface to print it as a plain line.

The mod draws no bar in the terminal, where the status line script below does that job.

## Terminal status line

[`statusline/statusline.ps1`](statusline/statusline.ps1) draws the same bar in the terminal, with extra detail:

```text
usage-bar-mod main ?1  |  Opus 5.5 [high]  [█░░░░░░░░░░░░░░░░░░░] 5%  54k / 1M  5h 56% (2h) · 7d 25% (4d)  cache (50m)  ~$0.21
```

On top of the mod's figures, it shows:

- The git repository, branch and working tree state.
- The model, coloured by cost tier, and the effort level.
- A countdown to when the prompt cache expires.

The script is not part of the plugin, so installing the mod does not set it up.
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
