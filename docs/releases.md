# Releases

A version tag releases Subsets. `.github/workflows/release.yml` on GitHub
publishes the npm package to public npm and creates the GitHub release. It also
publishes to the Gitea npm registry when the `GITEA_NPM_TOKEN` secret is set.
The landing page at https://subsets.subcult.tv is deployed from `main` by
`.github/workflows/deploy.yml`, so every merge to `main` updates it.

`.gitea/workflows/release.yml` is the older release workflow. Kvant copies tags
from GitHub to Gitea, and copied tags do not start Gitea workflows, so it runs
only when dispatched by hand. Use it to deploy the landing page of a historical
tag (see Roll back).

## Cut a release

Bump `package.json`, `package-lock.json` and `VERSION` in `node/src/cli.ts`
together, merge, then tag the merge commit on `main` and push the tag to GitHub:

```sh
git tag -a v0.2.0-alpha.7 -m "Subsets 0.2.0-alpha.7" origin/main
git push origin v0.2.0-alpha.7
```

A pre-release part (`-alpha.7`) publishes under that npm dist-tag (`alpha`) and
marks the GitHub release as a pre-release; a plain version publishes as `latest`.

| Job      | Does                                                                                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify` | Checks that the tag, `package.json` and `subsets --version` agree, then runs the Node tests, typecheck, format check and Python tests on the tagged commit.                                                                                                                   |
| `npm`    | Packs once and publishes that tarball to public npm (and Gitea, if its token is set). A registry that already has the version is skipped, so a rerun is safe. Each registry must then serve the packed integrity. Attaches the tarball and its SHA-256 to the GitHub release. |

"Run workflow" with an existing tag and **publish** off runs `verify`, packs,
checks the registry logins and changes nothing. Use it after rotating a secret.

## Secrets

GitHub repository secrets used by `release.yml`:

| Secret            | Holds                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN`       | A granular npmjs.org access token with read and write access to the `@subcult` packages and "bypass two-factor authentication" enabled, so CI can publish. |
| `GITEA_NPM_TOKEN` | Optional. A Gitea token with package write access to `subculture-collective`. Without it the Gitea registry is skipped.                                    |

The Gitea workflow uses `NPM_TOKEN`, `ALMAZ_DEPLOY_KEY_B64` (the release SSH
key, base64-encoded on one line) and `ALMAZ_KNOWN_HOSTS` from Gitea's secrets.
Keep every secret on one line.

## The deploy on Almaz

The release key's `authorized_keys` entry on Almaz is
`restrict,from="10.0.0.50",command="/home/onnwee/.local/bin/subsets-release-ssh"`.
It works only from Kvant's address, which both CI runners leave through, and can run only:

- `receive REVISION`: loads the image from standard input and checks its revision label;
- `deploy REVISION`: records a receipt under `~/.local/share/subsets/releases/<rev12>/`, runs the image as `subsets-landing` in Compose project `subsets` and waits for its health check. It then requires the public page to serve the image's `index.html`. If that check fails, it restarts the previous image;
- `status`: the running image and revision.

The automatic main lane uses `receive-main REVISION` and `deploy-main REVISION`.
They use the full revision image namespace and require the current repository
`main` before receipt and immediately before activation. Older queued CI runs
refuse deployment. Tagged `receive`/`deploy` operations continue to support
deliberate historical releases and rollback. All modes share the same host lock,
waiting up to five minutes for another landing operation to finish.
Main retries always verify readiness and public HTML, including when the image
name already matches. Receipts retain the previous immutable image ID so a
retagged candidate cannot replace its own rollback image.

After merging a receiver change, install it on Almaz before the new main deploy
job runs. An older installed receiver refuses the new main-only commands before
activation; install the reviewed merged source and retry CI if that occurs.
The receiver requires `git` and `flock` in addition to the existing Docker/curl
tools. The main lane uses the existing landing key and pinned host-key secrets;
package registry tokens remain with the package release jobs.

Tagged deployments retain the already-live shortcut. Main deployments run
verification on every retry. The receiver and its `compose.yml` are copies.
After changing `deploy/release-ssh.sh` or
`deploy/compose.yml`, install them on Almaz from a checkout of the merged change:

```sh
deploy/install-release-tools.sh
```

## Roll back

npm versions are immutable: publish a fixed version, or move the dist-tag back
with `npm dist-tag add @subcult/subsets@PREVIOUS alpha`. For the site, rerun
the Gitea release workflow for the previous tag with publish on; its image is rebuilt
and deployed, and the receipt names the image it replaced.

Finish or cancel pending main landing runs before deliberately restoring an
older tagged site. A later verified main push deploys the landing page again.
