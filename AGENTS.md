# hast-claude-mods

Claude Code mods published as one plugin marketplace.
Each mod lives in its own folder (`usage-bar/`, `repo-sync/`) with its own `.claude-plugin/plugin.json`.
`.claude-plugin/marketplace.json` at the root lists them all.

## Versions

Each mod's `plugin.json` sets a `version`, and Claude Code only updates an installed copy when that string changes.
A change that is pushed without a bump never reaches anyone who already has the mod installed.

- Bump the mod's version for any change to what it ships: hooks, types, settings in `plugin.json`.
- A change to docs or tests alone needs no bump.
- While a mod is on `0.x`, a `fix` bumps the patch number, and a `feat` or a breaking change bumps the minor number.
- A renamed or removed setting is a breaking change, since installed copies lose the value.
- Bump in the same commit as the change, or in a `chore(<mod>): bump to x.y.z` commit straight after it.
- Keep each plugin's `description` in `marketplace.json` the same as the one in its `plugin.json`.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.
- Scope: the mod's folder name (`usage-bar`, `repo-sync`), or `marketplace` for `.claude-plugin/marketplace.json`.
  Leave the scope out for changes across the whole repo.
- Write the summary as a plain imperative sentence in lower case, with no full stop: `fix(usage-bar): name the git segment after the origin remote`.
- Mark a breaking change with `!` after the scope, and say what breaks in a `BREAKING CHANGE:` footer.
- Commit and push straight to `main`; the history is linear, with no branches or merge commits.

## Checks

From inside a mod's folder, before committing a change to it:

```shell
claude plugin validate .
claude plugin test .
```

## Writing

- Put each full sentence of Markdown on its own line.
- Write user-facing text in plain language: the READMEs and the setting titles and descriptions in `plugin.json`.
- Credit adapted code in the mod's `THIRD-PARTY-NOTICES.md` and its README.
