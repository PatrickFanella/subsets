# Releases

A version tag releases Subsets: it publishes the npm package to the Gitea
registry and public npm, creates the Gitea release, and deploys the landing page
at https://subsets.subcult.tv. Use the same flow for `@subcult/patstack` in the
`generic-skills` repository, which has the npm and Gitea release steps but no site.

## Cut a release

Bump `package.json`, `package-lock.json` and `VERSION` in `node/src/cli.ts`
together, merge, then tag the merge commit on `main`:

```sh
git tag -a v0.2.0-alpha.5 -m "Subsets 0.2.0-alpha.5" origin/main
git push origin v0.2.0-alpha.5
```

A pre-release part (`-alpha.5`) publishes under that npm dist-tag (`alpha`) and
marks the Gitea release as a pre-release; a plain version publishes as `latest`.

`.gitea/workflows/release.yml` then runs:

| Job | Does |
|---|---|
| `verify` | Checks that the tag, `package.json` and `subsets --version` agree, then runs the Node tests, typecheck, format check and Python tests on the tagged commit. The other jobs wait for it. |
| `npm` | Packs once and publishes that tarball to the Gitea registry and public npm. A registry that already has the version is skipped, so a rerun is safe. Each registry must then serve the packed integrity. Attaches the tarball and its SHA-256 to the Gitea release. |
| `site` | Builds `deploy/Dockerfile` labelled with the revision, streams it to Almaz over SSH and deploys it. |

"Run workflow" with an existing tag and **publish** off runs `verify`, packs,
checks both registry logins and the Almaz key, and changes nothing. Use it after
rotating a secret.

## Secrets

| Secret | Holds |
|---|---|
| `NPM_TOKEN` | A granular npmjs.org access token with read and write access to the `@subcult` packages and "bypass two-factor authentication" enabled, so CI can publish. |
| `ALMAZ_DEPLOY_KEY_B64` | The release SSH key, base64-encoded on one line. Gitea masks a secret only where the printed text matches exactly, which a multi-line key does not. |
| `ALMAZ_KNOWN_HOSTS` | Almaz's host key line for `10.0.0.200`. |

The Gitea registry uses the workflow's own token, which expires with the job.
Keep every secret on one line.

## The deploy on Almaz

The release key's `authorized_keys` entry on Almaz is
`restrict,from="10.0.0.50",command="/home/onnwee/.local/bin/subsets-release-ssh"`.
It works only from Kvant's address, which both CI runners leave through, and can run only:

- `receive REVISION`: loads the image from standard input and checks its revision label;
- `deploy REVISION`: records a receipt under `~/.local/share/subsets/releases/<rev12>/`, runs the image as `subsets-landing` in Compose project `subsets` and waits for its health check. It then requires the public page to serve the image's `index.html`. If that check fails, it restarts the previous image;
- `status`: the running image and revision.

A revision that is already live is left as it is. The receiver and its
`compose.yml` are copies. After changing `deploy/release-ssh.sh` or
`deploy/compose.yml`, install them on Almaz from a checkout of the merged change:

```sh
deploy/install-release-tools.sh
```

## Roll back

npm versions are immutable: publish a fixed version, or move the dist-tag back
with `npm dist-tag add @subcult/subsets@PREVIOUS alpha`. For the site, rerun
the release workflow for the previous tag with publish on; its image is rebuilt
and deployed, and the receipt names the image it replaced.
