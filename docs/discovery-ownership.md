# Discovery and folder ownership

These rules define where Subsets looks and which changes it may make. Discovery is read-only. A found `SKILL.md` does not give the app ownership of its folder.

## Default search locations

| Location | Treatment |
|---|---|
| `$CODEX_HOME/skills`, otherwise `~/.codex/skills` | User installation; known installer receipts retain their owner. |
| `~/.agents/skills` | Shared installation; an existing profile manager retains its owner. |
| `~/.claude/skills` | Claude user skills; links and known source-link installers retain their owners. |
| `$XDG_CONFIG_HOME/opencode/skills`, otherwise `~/.config/opencode/skills` | OpenCode user skills. |
| `~/.opencode/skills` | Additional OpenCode-compatible location; client discovery should be checked separately. |
| `.agents/skills`, `.codex/skills`, `.claude/skills`, `.opencode/skills` in the explicit project and its ancestors | Project-local scope. Stop at home/root; do not recurse into sibling repositories or worktrees. |
| Codex `skills/.system` | System-owned metadata only. |
| Codex `plugins/cache/*/*/*/skills` and `*/*/skills` | Bounded plugin-layout metadata only, including retained versions. |
| Explicit `--root PATH` and remembered `root add PATH` entries | Only the named directory's immediate skill children. Remembered entries default to read-only. |
| Recognized codex-skills optional library | Canonical source, filtered through reserved/retired/blocked ownership; existing backend manages activation. |

Claude's documented personal/project directories are `~/.claude/skills` and `.claude/skills`. OpenCode documents its native paths and compatibility with Claude/shared skill paths. Client search overlap does not prove identical invocation or tool behavior. Sources: [Claude skills](https://code.claude.com/docs/en/skills), [OpenCode skills](https://opencode.ai/docs/skills/).

Each root scan examines at most 5,000 immediate children. Plugin discovery uses bounded published layout patterns; it does not crawl an entire cache or filesystem. A skill needs a `SKILL.md` with safe YAML frontmatter, a matching lowercase name, and a nonempty description. Entrypoints over 1 MiB, malformed metadata, and mismatched names remain visible as findings but are ineligible for adoption. Resources are never imported as code during discovery. Skill scripts are never executed by this app.

Root-qualified IDs distinguish same-name skills across clients and scopes. Linking to one physical source is shown as linked ownership, rather than deduplicating away its consumer paths. Versions and client installations remain distinguishable. File discovery is independent of whether a running client has loaded the skill.

## Ownership decisions

1. OS-managed targets under `/usr`, `/opt`, `/nix`, system directories, and plugin caches remain package-owned. The app never adopts those roots or imports their caches.
2. Roots with recognized profile state, installer receipts, project `.agent-skills.json` or common skill lockfiles retain their installer. The codex-skills authoring source also retains its owner. Existing backend actions preserve its own rules and journals.
3. Symlink roots and symlink parents cannot be mutation destinations. Linked individual skills remain with their source owner; adoption preserves them in place. Import a reviewed authoring folder explicitly instead of copying a link that will break in the private library.
4. A remembered read-only root cannot be adopted. Change its declaration deliberately if it is user-owned. Declaring an existing package/installer root unmanaged cannot override its detected owner.
5. An unmanaged folder may be adopted explicitly. Subsets creates a `.subsets-owner.json` binding it to exactly one private registry. Overlapping managed roots, overlapping state/source roots, and a second registry claiming the same folder are rejected.
6. Adoption preserves invalid entries, externally owned links, hidden system folders and unrelated files. Only eligible immediate skill paths enter the mutation registry. Skills added by another process after adoption stay unmanaged until an explicit import/reconciliation.
7. Library copies preserve skill resources, notices, executable modes and internal relative symlinks. External or absolute resource symlinks require author review. Canonical copies and verified original snapshots are kept outside client discovery.
8. Group application can activate, update or deactivate registered paths only. Every destination must match the recorded before-state. Deactivation retains the canonical source and transaction backup; it is not source deletion.
9. Recovery checks all touched paths before restoration and preserves later edits. Missing or changed ownership markers are errors. Adoption rollback releases ownership by restoring the marker and registry before-state; undo later related transactions first.

Unknown third-party installers cannot all be inferred from a folder layout. Review the displayed owner before adopting a root; declare uncertain folders read-only. The first release does not automatically migrate another manager's registry, rewrite source repositories, install remote skills, or decide which instructions are safe or useful.

## Adding clients or backends

Add a bounded root rule with a client and scope, document how that client actually discovers skills, and test positive and near-miss layouts. Native/project/plugin locations must remain distinct. Add ownership receipt detection before supporting changes to an installer-managed folder.

A backend must expose read-only preview, explicit application, destination verification, and recoverable receipts. Show precisely which client's files it changes, whether a fresh session is needed, and whether the change is atomic or can partially complete. An unsupported client/tool contract should stop the affected selection instead of silently copying instructions.

Standalone selections operate on registered target roots. They do not automatically mirror skills into every client. Register each desired consumer deliberately; same-name conflicts require explicit root IDs. Avoid registering overlapping roots or the private library as a discovered destination.
