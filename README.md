# usage-bar

A Claude Code mod that draws a coloured usage bar above the prompt, on any surface you turn it on for.

```text
usage-bar-mod main ?1  |  Opus 5.5 [high]  [█░░░░░░░░░░░░░░░░░░░] 5%  54k / 1M  5h 56% (2h) · 7d 25% (4d)  C (50m)  ~$0.21
```

From left to right, the bar shows:

- The git repository, branch and working tree state, if turned on.
- The model and effort level, if turned on.
- Context window fill, as a bar, a percentage and a token count.
- Quota used in the 5-hour and 7-day windows, with the time until each resets.
- A countdown to when the prompt cache expires, shown as `C`, if turned on.
- The session's cost, plus the amount charged to credits once a quota window reaches 100%.

## Install

At the prompt of a terminal session:

```text
/plugin install usage-bar --marketplace hastarin/hast-claude-mods
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```shell
claude plugin install usage-bar --marketplace hastarin/hast-claude-mods
```

In the desktop app, where `/plugin` does not run, click + next to the prompt box, then Plugins, Add marketplace with `hastarin/hast-claude-mods`, then Add plugin.

## Usage

The bar appears by itself in the terminal, on the desktop app and in VS Code.
Run `/usage-bar` on any surface to print the whole line as plain text, with every segment it has a reading for.

## Settings

Each environment has its own settings.
Change them in `/config`, in the Manage Plugins dialog in VS Code, or under Settings, Plugins, Usage bar in the desktop app.

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
A compaction shows its new size straight away, or 0 if the engine did not record one, and `/clear` shows 0.

Quota readings come with responses, so each session leaves its newest in the mod's store, and the others pick it up within about 10 seconds.
That covers sessions on the same computer, once each has had a reading of its own.
Use on another computer or on claude.ai shows after your next reply.
Sessions signed in to different accounts on one computer share readings too, unless they use separate `CLAUDE_CONFIG_DIR` folders.
A window whose reset has passed reads 0% straight away.

When the line is too long for the space, the context bar shrinks to as few as 8 cells, then gives way to a single ring (`○◔◑◕●`) before the line wraps.

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

## Colours

Context is coloured by whichever is worse of how full the window is and how many tokens it holds.
By fill: green, then amber at 50%, orange at 75%, red at 90% and gold at 100%.
By size: amber from 100k tokens, orange from 200k and red from 300k, whatever the window.
Every turn re-reads the whole context, and long contexts drift, so size matters well before a 1M window fills.
Treat orange as the point to consider compacting.

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

A session started with `--plugin-dir` has its own store, so it shares quota readings only with other `--plugin-dir` sessions, not with an installed copy.

## License

[MIT](LICENSE)

The cache countdown adapts code and ideas from [`cache-timer`](https://github.com/arasovic/claude-code-mods) by Mehmet Aras and [`cache-keeper`](https://github.com/nateherkai/claude-code-mods) by Nate Herk, both MIT licensed.
See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
