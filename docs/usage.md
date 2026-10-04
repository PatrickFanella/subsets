# Subsets

Subsets discovers agent skills on disk, helps organize named groups, and applies a selection through registered folder ownership or the existing codex-skills backend. The native npm edition uses TypeScript and Ink. Open the TUI with `subsets`; automate the same operations with its CLI.

The native alpha requires Node.js 22 or newer and has been qualified on Linux. macOS has not been qualified; Windows is unsupported. The original Python edition requires Python 3.11 or newer and uses Textual and POSIX filesystem locks. The native edition uses Ink and an exclusive directory lock. The source repository is [subculture-collective/subsets](https://git.subcult.tv/subculture-collective/subsets). The alpha is distributed through the SUBCULT registry; npmjs.org publication is pending account setup.

## Install and open

The native npm app requires Node.js 22 or newer. Configure the SUBCULT package scope once, then install the preview:

```sh
npm config set @subcult:registry https://git.subcult.tv/api/packages/subculture-collective/npm/
npm install -g @subcult/subsets@alpha
subsets
```

Try it without a global installation:

```sh
npx @subcult/subsets@alpha discover --json
npx @subcult/subsets@alpha
```

The registry may require an account with package read access. See [npm installation and development](npm.md) for authentication, local package testing, state ownership, and updates.

The native standalone workflow requires no Python. The existing codex-skills adapter uses that installation’s Python 3 helpers; set `SUBSETS_PYTHON` to select its interpreter.

The original Python implementation remains available during the port:

```sh
uv tool install git+https://git.subcult.tv/subculture-collective/subsets.git
```

Both installations provide a `subsets` command; choose which launcher is on your PATH. They have separate registries and cannot adopt a folder owned by the other installation.

The TUI requires an interactive terminal. Every mutation also has a noninteractive CLI path, with JSON output for automation.

## Organize and apply

Inspect the detected folders with `subsets roots`. Adopt an unmanaged folder by its displayed root ID:

```sh
subsets adopt ROOT_ID
subsets group create creative-writing poetry editing
subsets apply --creative-writing --dry-run
subsets apply --creative-writing
subsets verify
subsets history
subsets rollback TRANSACTION_ID
```

Adoption leaves the existing skills in place, makes verified canonical copies in Subsets’ private library, and records the paths it may subsequently manage. It creates a `current-ROOT_ID` group representing that folder's original selection. In the TUI, deselect this group and select your new group before previewing a narrower selection. `core` is always included; add skills to it when they should remain active across group changes.

Groups combine by union:

```sh
subsets apply --creative-writing --research --dry-run
subsets apply --group creative-writing --group research
subsets group add creative-writing storytelling
subsets group remove creative-writing editing
subsets group add core fact-check
```

Short flags are accepted only for existing group names. A misspelled group fails instead of applying an empty selection. Duplicate skill names require their displayed `ROOT_ID:skill-name` IDs. `--group NAME` is the stable explicit syntax.

Inactive skills remain in the private library. To add another source folder and import a skill into a registered destination:

```sh
subsets root add ~/SkillSources --owner readonly
subsets discover
subsets import SOURCE_ROOT_ID:storytelling --to TARGET_ROOT_ID
subsets group add creative-writing TARGET_ROOT_ID:storytelling
```

Imports do not activate a skill until a group containing it is applied. Create an empty supported destination such as `~/Project/.agents/skills`, register it with `root add PATH --owner unmanaged`, then adopt it. Source folders default to read-only when explicitly registered. For a one-off inspection, use `--root PATH` instead.

## TUI workflow

- Native TUI: use 1–4 for Skills, Folders, Groups, and Recovery. `/` searches; Space picks a skill or toggles a group. `g` creates a group from picked skills, `a` adopts the selected folder, `p` previews, and `u` rolls back the selected transaction. Confirm with `y` or cancel with `n`. `r` rescans and `q` exits.
- Python TUI: search with Ctrl+F. Enter on a skill toggles it for group editing.
- In Folders, select a root and choose **Adopt folder**. The dialog explains the ownership change.
- **Edit group** creates a group or adds/removes the picked skills. Eligible optional library skills edit canonical existing profiles; adopted skills edit Subsets groups.
- Select groups in the sidebar, then **Preview** or Ctrl+P. The preview is checked again when you choose **Apply selection**.
- Recovery lists Subsets transactions. Select one and choose **Rollback**. Changes made through the existing deployment backend retain that backend's receipts and rollback commands.
- Ctrl+R rescans. Q exits. The interface adapts to 80×24 and larger terminals.

## Existing codex-skills installations

Subsets recognizes the canonical source behind `~/.agents/bin/skill-profile`. It displays eligible optional library skills and named profiles, excludes reserved/retired/blocked names, and sends selected profiles through `skill-profile` and `optional-clients.py`. It preserves the curated personal base, shared core, plugins, vault ownership and project installations.

```sh
subsets apply --mobile --dry-run
subsets apply --mobile
subsets group create creative-writing copywriting storytelling --backend existing
```

The last example requires those names to be eligible in the actual library. Use discovery to choose available skills. Profile edits write only the named canonical `profiles/NAME.txt`, preserve existing comments, and have a Subsets backup/receipt. Review and commit these configuration edits with the source repository. The app does not automatically commit, push, or publish them.

An existing backend profile selection applies to optional Codex/shared skills and explicit Claude links. It does not transfer tools, authentication, settings, or permissions. Unsupported Claude contracts stop preview. If the backend fails after Codex activation, the app reports partial completion and retains the backend's recovery state. This bridge is sequential rather than one atomic cross-client transaction.

Subsets groups and existing backend profiles cannot be combined in one apply. They have separate ownership and recovery. Explicitly choose `--backend subsets` or `--backend existing` when editing or applying groups if the names are ambiguous. For a new machine without this repository, the standalone adoption/library/group workflow requires no codex-skills source.

## State and recovery

Native state defaults to `$XDG_DATA_HOME/subsets/node`, or `~/.local/share/subsets/node`, with registry version 2. Python state uses `$XDG_DATA_HOME/subsets` and registry version 1. Use `SUBSETS_HOME` or `--state PATH` for an isolated registry. It contains `registry.json`, the canonical `library/`, and journaled `transactions/` with verified before-state backups. The state directory has mode 0700; registries and journals have mode 0600. Keep this directory while recovery may be needed.

Apply preflights all registered paths before mutation, verifies copied resources and executable modes, and checks again before replacements. Drift stops application. An interrupted apply blocks later changes until its transaction is rolled back. Rollback preflights every affected path and refuses later edits, including group/registry edits. Undo newer transactions first when they changed the same registry. Unregistered skills and other root files are preserved.

Subsets does not rewrite skill instructions or execute their scripts. Adoption is a filesystem ownership decision, not proof of tool compatibility, instruction quality, licensing, or actual agent behavior. Disk discovery also includes installed plugin versions that may be inactive; it is not the client's live skill catalog. Start a fresh client session after changing selection and verify its discovery separately.

See [discovery and ownership rules](discovery-ownership.md) for the supported locations, guardrails, and extension procedure.

## Development

```sh
npm ci
npm test
npm run format:check
npm pack

# Original Python implementation
uv run --extra test pytest
uv build
```

Tests cover discovery scope, adoption, grouping, application, idempotency, imports, resource modes, interrupted recovery, drift, package/installer ownership, CLI flags, existing profile authoring, and an interactive TUI flow.
