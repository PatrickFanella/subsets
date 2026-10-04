# Native npm edition

The npm package is `@subcult/subsets`; its command is `subsets`. The preview version is `0.2.0-alpha.1`. It runs the standalone workflow in Node.js 22 or newer without Python. Linux is locally tested; macOS remains unverified. Windows is not supported by this preview.

## Install from the hosted registry

Keep the public npm registry for third-party dependencies and configure only the SUBCULT scope:

```sh
npm config set @subcult:registry https://git.subcult.tv/api/packages/subculture-collective/npm/
npm install -g @subcult/subsets@alpha
subsets --version
subsets
```

If package reads require authentication, add a package-read token for this registry to your private npm configuration. Do not put tokens in the repository or commands. The canonical registry endpoint is Gitea’s organization npm API; `npm.subcult.tv` is not assumed to serve the same package collection.

```sh
npx @subcult/subsets@alpha discover --json
npm update -g @subcult/subsets
```

## State and ownership

Native state defaults to `~/.local/share/subsets/node` (or `$XDG_DATA_HOME/subsets/node`). `SUBSETS_HOME` or `--state` overrides it. Native registries use version 2 and Python registries use version 1. Neither implementation migrates or writes the other’s registry. Folder markers prevent a second registry from adopting an already managed folder. This preview does not migrate existing Python-managed folders.

Each mutation creates an exclusive `node-lock` directory with `owner.json` recording the PID, host, and start time. The lock is released after normal completion and exceptions. A killed process may leave a lock. Verify the recorded process has stopped on the recorded host before removing that exact lock directory; then inspect `subsets history` and roll back unfinished transactions. The app does not automatically steal stale locks.

Filesystem journals provide tested interrupted-operation recovery and refuse later edits. They do not establish recovery from arbitrary power loss. Keep the canonical library and transaction backups while recovery is needed.

## Existing codex-skills adapter

Discovery, profile editing, and backend selection retain their existing owners. Applying an existing profile runs the canonical Python helpers through `python3`, or `SUBSETS_PYTHON` when set. That backend needs its Python dependencies. Codex and Claude application is sequential; a partial failure is reported with instructions to retain the backend receipts.

The standalone workflow has no Python dependency. Neither installation automatically switches your active profile.

## Build and qualify

```sh
npm ci
npm test
npm run typecheck
npm run format:check
npm pack --pack-destination /tmp
```

Install the resulting tarball in a fresh directory outside the checkout and run its installed `subsets` executable. Test adoption, group creation, dry-run, apply, idempotency, and rollback against disposable skill folders. The package includes compiled JavaScript and declarations; no install-time compilation or postinstall script runs.

## Publish a preview

Use the configured agent’s package-write credentials through a private npm configuration. Inspect `npm pack --dry-run` first, qualify the exact tarball, then publish that tarball with `--tag alpha`. Keep version and command output aligned. Read back the registry metadata and install that exact version in a fresh directory after publishing.

Publishing to npmjs.org and migrating Python registries are separate future steps.
