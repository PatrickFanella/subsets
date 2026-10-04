<p align="center"><img src="https://subsets.subcult.tv/assets/brand/social/banner-x-bluesky.png" alt="Subsets — All your skills. Only the set you need." width="100%"></p>

# All your skills. Only the set you need.

Your agent skills are a collection. Every task needs a different part of it.

**Subsets** finds the skills on your computer, helps you group them for the work at hand, and previews what will change before you apply a set. Open its terminal interface to explore the collection, or use the same workflow from the command line.

**[Explore Subsets](https://subsets.subcult.tv)** · **[Made by SUBCULT](https://subcult.tv)** · **[Support us on Patreon](https://support.subcult.tv)**

## A set for whatever’s next

- **Find your collection.** Discover skills in supported user and project folders, with their locations and owners visible.
- **Group them for the work.** Create a writing set, a development set, or your own combination. Keep everyday essentials in `core`.
- **Preview, then apply.** See the plan before changing an adopted folder. Combine groups when a task needs both.
- **Keep a way back.** Inactive skills stay in a private library, and transactions record the changes for checked rollback.

```sh
subsets group create creative-writing editing research
subsets apply --creative-writing --dry-run
subsets apply --creative-writing
```

Start with `subsets roots` and explicitly adopt an unmanaged folder before using that example. Use the skill names in your own collection. Start a fresh agent session after applying a different set.

## Get the alpha

The native npm edition requires **Node.js 22 or newer** and an interactive terminal for the TUI. Install the alpha from npmjs.org:

```sh
npm install -g @subcult/subsets@alpha
subsets
```

Linux is tested. macOS remains unverified; Windows is not supported by this preview. The standalone native workflow needs no Python. If you previously configured the `@subcult` scope for Gitea, set it to `https://registry.npmjs.org/` before installing or updating from public npm.

[Installation and updates](docs/npm.md) · [Full workflow guide](docs/usage.md) · [Folder ownership and recovery](docs/discovery-ownership.md)

## Your folders stay yours

Discovery is read-only. You decide which unmanaged folders Subsets may adopt. Package, plugin, and installer-owned folders retain their owners. Drift checks stop application or recovery when files have changed since the saved state.

Subsets does not rewrite skill instructions or run their scripts. Discovery shows what is on disk; it does not establish which skills an agent session has loaded.

## Made by SUBCULT

Subsets is one of the tools we make at **[SUBCULT](https://subcult.tv)**. Explore the other projects there, and **[support the work on Patreon](https://support.subcult.tv)** if you want to help us keep building.

The Personal Utility identity uses silver, charcoal, mint selections, and an original selected-tile mark. [Branding notes](docs/branding.md) describe the system and its Studio source.

## Contribute

Issues and pull requests live on [our Gitea repository](https://git.subcult.tv/subculture-collective/subsets). For local development:

```sh
npm ci
npm test
npm run typecheck
npm run format:check
```

Subsets is licensed under [AGPL-3.0](LICENSE).
