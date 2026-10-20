# Native npm edition

The npm package is `@subcult/subsets`; its command is `subsets`. The preview version is `0.2.0-alpha.3`. It runs the standalone workflow in Node.js 22 or newer without Python. Linux is locally tested; macOS remains unverified. Windows is not supported by this preview.

## Install from public npm

```sh
npm install -g @subcult/subsets@alpha
subsets --version
subsets
```

If you previously configured `@subcult` to use Gitea, switch that scope before installing or updating:

```sh
npm config set @subcult:registry https://registry.npmjs.org/
```

The patch fixes startup discovery when Codex's system skills contain installer marker files. Ordinary files and links to files are skipped without interrupting the rest of the inventory.

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

The public npm release and the hosted Gitea preview are separate registries. Neither migrates Python registries.

## Public npm publishing

The package's public npm configuration points to `https://registry.npmjs.org/`. Publish the qualified tarball with `--access public --tag alpha`, then confirm metadata and installation from that registry. Version `0.2.0-alpha.2` was the first public npm release.

The publisher needs an npm account with control of the `@subcult` user or organization scope, verified email, and npm’s required publishing authentication. For an interactive first release, use `npm login --scope=@subcult --registry=https://registry.npmjs.org` on the publishing computer, then publish the qualified tarball with `--access public --tag alpha`. Respond to the browser/2FA prompts locally. Never put passwords, OTP codes, or tokens into the repository or chat. If the scope is unavailable, settle the package scope before publication.

Prepare the exact candidate tarball, hashes, package contents, and qualification record before publication. Publication is complete only after account authorization and registry readback succeed. See [npm scoped-public-package guidance](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/) and [npm publishing authentication requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).
