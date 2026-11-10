<p align="center"><img src="https://subsets.subcult.tv/assets/brand/social/banner-x-bluesky.png" alt="Subsets: all your skills, only the set you need." width="100%"></p>

# Subsets

Your agent skills are a collection, and every task needs a different part of it.

Subsets finds the agent skills on your computer, groups them, and switches which ones are active. It previews every change before applying it and keeps a record so you can roll back. Use the terminal interface to browse, or the same commands from scripts. It works with the skill folders of Codex, Claude Code, OpenCode, GitHub Copilot, Cursor and the shared `.agents` folder.

Subsets is an alpha. Linux is tested; macOS is untested and Windows is not supported.

Website: [subsets.subcult.tv](https://subsets.subcult.tv)

## Features

- **Discovery.** Lists skills in user folders (`~/.codex/skills`, `~/.claude/skills`, `~/.agents/skills`, OpenCode, Copilot and Cursor) and in project folders, with each folder's owner. Discovery only reads.
- **Adoption.** You choose which unmanaged folders Subsets may manage. Adopting a folder copies its skills into a private library and records the original selection as a `current-<root>` group. Package, plugin and installer-owned folders keep their owners.
- **Groups.** Create named groups such as a writing set or a development set. `core` is always included; groups combine by union.
- **Preview and apply.** `--dry-run` shows the plan. Apply checks every path again, stops if files changed since the saved state, and journals the change.
- **Rollback.** Each apply is a transaction with verified backups. `subsets history` lists them and `subsets rollback` undoes one.
- **Skill packs.** Optional packs are npm packages of skill folders. `subsets pack add` imports a pack's skills inactive into a group of the same name.
- **Terminal interface.** Tabs for skills, folders, groups and recovery, with search and keyboard shortcuts. It fits an 80×24 terminal.

Subsets does not rewrite skill instructions or run their scripts. Discovery shows what is on disk; it does not tell you which skills an agent session has loaded.

## Install

The npm edition needs Node.js 22 or newer.

```sh
npm install -g @subcult/subsets@alpha
subsets            # open the terminal interface
subsets --version
```

Try it without installing:

```sh
npx @subcult/subsets@alpha discover --json
```

If you earlier pointed the `@subcult` npm scope at another registry, reset it first with `npm config set @subcult:registry https://registry.npmjs.org/`.

## Usage

```sh
subsets roots                                   # list detected folders and their IDs
subsets adopt ROOT_ID                           # let Subsets manage one folder
subsets group create creative-writing editing research
subsets apply --creative-writing --dry-run      # preview
subsets apply --creative-writing                # apply
subsets apply --creative-writing --research     # combine groups
subsets verify
subsets history
subsets rollback TRANSACTION_ID
```

Use the skill names from your own collection. Start a new agent session after applying a different set.

In the terminal interface, keys 1 to 4 switch between Skills, Folders, Groups and Recovery. `/` searches, Space picks a skill or toggles a group, `g` creates a group from picked skills, `a` adopts a folder, `p` previews, `u` rolls back a transaction, `r` rescans and `q` quits.

The first time the interface opens, it offers the patstack skill pack. Decline with `n`, or skip the prompt with `--no-pack` or `SUBSETS_NO_PACK=1`. Manage packs later with `subsets pack list`, `subsets pack add patstack` and `subsets pack remove patstack`.

More detail:

- [Usage guide](docs/usage.md)
- [Install and update](docs/npm.md)
- [Discovery and folder ownership](docs/discovery-ownership.md)

## Configuration

State lives in `$XDG_DATA_HOME/subsets/node` (default `~/.local/share/subsets/node`), with mode 0700. Set `SUBSETS_HOME` or pass `--state PATH` to use a separate registry. Keep this folder while you may need to roll back.

## Python edition

The original Python edition (Python 3.11 or newer, Textual interface) is in `src/subsets`. It keeps a separate registry and does not support packs. Install it from a checkout with `uv tool install .`.

## Development

```sh
npm ci
npm test               # build, then run the Node tests
npm run typecheck
npm run format:check

uv run --extra test pytest   # Python edition tests
```

The landing page in `site/` is a static site; `deploy/` has a Dockerfile and nginx config that serve it.

## Contributing

Report bugs and request features in [GitHub issues](https://github.com/subculture-collective/subsets/issues). Ask questions and share ideas in [GitHub Discussions](https://github.com/subculture-collective/subsets/discussions). Open pull requests on GitHub against `main`. CI runs the Node tests, type check, Prettier check and the Python tests on every pull request.

## License

Subsets is made by [SUBCULT](https://subcult.tv) and licensed under [AGPL-3.0](LICENSE). If you want to support the work, see [our Patreon](https://support.subcult.tv).
