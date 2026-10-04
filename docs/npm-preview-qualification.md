# npm preview qualification — October 4, 2026

Package: `@subcult/subsets@0.2.0-alpha.1`, published with the `alpha` tag to the SUBCULT Gitea npm registry.

Application source: commit `bbb02f20e1a3df7f3ec1934953f2943ab5760fb1`.

Tarball SHA-256: `b6aba63be23354c7dc96906cbec42bcf7df5e5d4bdb18697e9418713a500cd06`.

## Verified on Linux

- 20 native tests passed on Node 22 and Node 26, including interactive adoption, search, group creation, preview, and confirmation.
- TypeScript compilation, strict type checks, and formatting checks passed.
- 23 original Python tests passed.
- An isolated tarball installation passed adoption, group creation, dry-run, apply, repeat apply, verification, and rollback with no Python on PATH.
- The exact published package passed the same isolated CLI workflow after installation from the hosted registry.
- Published integrity and version were read back from the registry. Anonymous metadata access and exact-version installation passed.
- The hosted package’s TUI rendered in an 80×24 terminal and exited successfully with `q`.
- The existing codex-skills adapter produced a real read-only profile plan. Production profile application was not performed.

## Boundaries

macOS remains unverified. Windows is not supported. Hosted CI is not configured. Native registries and Python registries are separate; no migration is claimed. This preview was not published to npmjs.org.

The native standalone workflow needs only Node. The optional existing-backend adapter needs its canonical Python helpers and dependencies.
