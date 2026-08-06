# Releasing Knot

How to publish an update of **Knot** (`freshgoldfish.knot-ai`) to the VS Code
Marketplace. v1 is macOS / Apple Silicon only. Linux (and eventually Windows) is
planned via platform-specific `--target` builds; see [`PLATFORMS.md`](./PLATFORMS.md)
(Phase 9) for the multi-target publishing plan.

## One-time setup

- **Publisher:** `freshgoldfish` on the
  [Marketplace](https://marketplace.visualstudio.com/manage/publishers/freshgoldfish).
  Created with a **personal** Microsoft account (not a work/school account, which
  hits an Azure AD tenant error).
- **Auth:** an Azure DevOps **Personal Access Token** with scope
  **Marketplace → Manage**, stored once via:
  ```bash
  npx @vscode/vsce login freshgoldfish
  ```
  Regenerate it at <https://dev.azure.com> → User settings → Personal access
  tokens when it expires.

## Release checklist

1. **Land your changes on `dev`** and open a PR to `main`
   (`gh pr create --base main --head dev`). All work flows through PRs.

2. **Bump the version** in `package.json` (`version`). Use semver:
   patch for fixes, minor for features. (Or let vsce do it with
   `vsce publish patch`, but bumping in the PR keeps `main` and the tag in sync.)

   In the same PR, **add an entry to `docs/RELEASES.md`** (a table row plus a
   short section for the new version). Update RELEASES.md on *every* release.

3. **Verify the packaged runtime closure** (see below). This is the step that
   catches the class of bug that broke v0.1.0/v0.1.1.

4. **Get assets onto `main` BEFORE publishing.** The Marketplace serves README
   images from GitHub raw at the default branch (`main`) HEAD, *not* from the
   `.vsix`. If screenshots/logos live only on `dev`, the listing shows broken
   images. So: merge the PR to `main` first, then publish from `main`.

5. **Publish from `main`:**
   ```bash
   git checkout main && git pull origin main
   npm run build
   npx @vscode/vsce publish        # uses the version already in package.json
   ```

6. **Tag the release** and sync `dev`:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   git checkout dev && git merge --ff-only main && git push origin dev
   ```

7. **Smoke-test the live listing** (~5 min after publish): in a clean VS Code,
   Extensions → search "Knot AI" → Install → open a folder → confirm the **Knot**
   output channel appears (`Knot activating.`) and onboarding runs.

## Verifying the packaged runtime closure (critical)

`@lancedb/lancedb` ships a platform-specific native binary, so it's marked
`external` in `esbuild.js` and is **not** bundled into `dist/extension.js`.
Instead it (and its own runtime dependencies) must be shipped inside the `.vsix`
via the `.vscodeignore` allowlist. If any package it `require()`s at load time is
missing, `require("@lancedb/lancedb")` throws at the top of the bundle,
`activate()` never runs, and the extension is silently dead on install (commands
show in the palette because they're declared in the manifest, but running one
says `command not found`, and there is no "Knot" output channel). **This does not
reproduce under F5**, which has the full `node_modules` on disk.

The current runtime closure (loaded when requiring `@lancedb/lancedb`) is:

```
@lancedb/lancedb
@lancedb/lancedb-darwin-arm64
apache-arrow
flatbuffers
reflect-metadata
tslib
```

All of these are allowlisted in `.vscodeignore`. **Whenever you add or upgrade a
dependency (especially `@lancedb/lancedb`), re-verify the closure:**

1. Re-trace what actually loads:
   ```bash
   node -e "require('@lancedb/lancedb');
   const s=new Set();
   for(const f of Object.keys(require.cache)){
     const m=f.match(/node_modules\/((@[^/]+\/[^/]+)|([^/]+))/);
     if(m) s.add(m[1]);
   }
   console.log([...s].sort().join('\n'));"
   ```
   Every line must be allowlisted (via `!node_modules/<pkg>/**`) in
   `.vscodeignore`.

2. Prove it from the actual package: pack, extract, and load from the shipped
   tree (this is exactly what VS Code does on install):
   ```bash
   npx @vscode/vsce package -o /tmp/knot-check.vsix
   rm -rf /tmp/knot-unpacked && mkdir /tmp/knot-unpacked
   (cd /tmp/knot-unpacked && unzip -q /tmp/knot-check.vsix &&
    cd extension && node -e "require('@lancedb/lancedb'); console.log('OK')")
   ```
   It must print `OK`. If it throws `Cannot find module '<x>'`, add `<x>` to the
   allowlist and repeat.
