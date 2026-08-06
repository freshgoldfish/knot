# Platform Support Plan

Status: **proposal / plan** (not yet implemented). Knot v1 ships macOS / Apple
Silicon only. This document plans **Linux support** as the next platform, and
records how platform-specific publishing works so Windows can follow later.

Related docs: [`RELEASING.md`](./RELEASING.md), [`HARDWARE_PROFILES.md`](./HARDWARE_PROFILES.md),
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Goal

Add support for **Linux x64 (glibc)** without regressing the macOS experience.
Out of scope for this pass: Windows, Intel Mac (`darwin-x64`), `linux-arm64`,
and musl/Alpine. Those are noted under "Later" so the groundwork is reusable.

## Why Linux is cheap (most of the code is already portable)

The core features (autocomplete, chat, Cmd+K, `@codebase`) only talk to Ollama
over HTTP on `127.0.0.1` and use VS Code APIs. None of that is OS-specific. The
macOS assumptions are concentrated in three files, and Linux shares the Unix
conventions the code already relies on:

- `findBinary()` scans `PATH` for `ollama` (no `.exe`), and `/usr/local/bin/ollama`
  (where the Linux installer puts it) is already in the path list.
  `src/services/ollamaService.ts`, `src/constants.ts`.
- `runShell()` uses `/bin/sh`, which exists on Linux. `src/services/ollamaService.ts`.
- `install()` runs the official `install.sh` via `curl ... | sh`, which natively
  supports Linux. `src/services/ollamaService.ts`.
- Disk check uses `statfs(homedir())`, which is cross-platform.

## How platform-specific Marketplace publishing works

This is the mechanism the whole plan hinges on, so it is worth stating plainly:

- There is still **one** Marketplace listing (`freshgoldfish.knot-ai`) and **one**
  version number. Platform-specific publishing does not create separate listings.
- You upload several `.vsix` files for the *same version*, each tagged with a
  `--target` (`darwin-arm64`, `linux-x64`, ...). VS Code sends its own OS + arch
  at install time and the Marketplace serves the matching build automatically.
  The user never chooses.
- Platforms you did not build a target for show as "not available for your
  platform" and cannot install. This is a feature: it prevents an install that
  would fail to activate.
- **Publish all supported targets together at the same version.** If v0.2.0 is
  published for `darwin-arm64` but not `linux-x64`, Linux users do not get v0.2.0
  until that target is also published.

Note on today's releases: v0.1.x are "universal" (no `--target`) and contain only
the `darwin-arm64` LanceDB binary, so a non-Mac user can install but activation
fails. Moving to `--target` publishing fixes that and is a prerequisite here.

## Work breakdown

### 1. Hardware detection (small)

`src/services/hardwareDetector.ts` currently reads RAM/chip/OS via macOS-only
commands (`sysctl`, `sw_vers`) and gates on `parseIsAppleSilicon`.

Plan:
- Branch on `process.platform`.
- Read RAM with `os.totalmem()` (cross-platform) instead of `sysctl hw.memsize`.
  This also simplifies the macOS path.
- On Linux: reuse the existing pure helpers `mapMemoryToTier()` and
  `applyDiskFallback()` (they take plain numbers, no changes needed), skip the
  Apple-Silicon / Metal / `sw_vers` logic entirely (GPU is Ollama's concern, not
  the extension's), and return a supported Linux profile.
- RAM-based auto-tiering works on Linux with no chip detection, so a manual
  model-size picker is optional, not required. (A picker can still be added later
  as an override for any platform.)

### 2. Types (small)

`src/types.ts`: the `HardwareProfile` has macOS-only fields
(`isAppleSilicon`, `metalSupported`, `macosVersion`, `macosMajor`,
`chipGeneration`, `chipVariant`). Add a `platform` discriminator and make the
mac-only fields optional (or model per-platform variants) so a Linux profile is
representable.

### 3. Ollama install on Linux (small, but a real UX decision)

`install()` shells out to `install.sh`, which on Linux uses `sudo` to write to
`/usr/local/bin`. We spawn with `stdio: "ignore"`, so a sudo password prompt
would hang or fail silently.

Plan: on Linux, do **not** auto-run the installer. Detect "not installed" and
show a guided step with the install command / download link for the user to run,
then re-check. (This mirrors what Windows will need later.) Add `/usr/bin/ollama`
to `OLLAMA_BINARY_PATHS` for good measure; the `PATH` scan already covers it.

### 4. Onboarding copy (small)

The onboarding webview references "your chip and RAM" and Apple Silicon. Make the
wording platform-aware (show chip/Metal details only on macOS).

### 5. Packaging: platform-specific VSIXes (medium, the main lift)

Switch from a single universal publish to per-target publishing:

```bash
vsce publish --target darwin-arm64   # existing behaviour, now explicit
vsce publish --target linux-x64      # new
```

The catch: `npm install` only installs the LanceDB native binary for the *current*
platform (it is an `optionalDependency`). So the `linux-x64` build needs
`@lancedb/lancedb-linux-x64-gnu` present in `node_modules` at package time. Two
ways:

- **Preferred: GitHub Actions matrix**, one native runner per target, so
  `npm install` pulls the correct binary automatically (see below).
- **Manual/local**: install the specific optional dep before packaging, e.g.
  `npm install --no-save @lancedb/lancedb-linux-x64-gnu@<version>` then
  `vsce package --target linux-x64`. Fragile; use only for a one-off test.

`.vscodeignore` already allowlists `!node_modules/@lancedb/**`, so whichever
platform binary is present ships correctly. Re-run the runtime-closure check from
`RELEASING.md` per target.

### 6. CI: build + publish matrix (medium)

Add `.github/workflows/release.yml` (sketch):

```yaml
name: Publish
on:
  push:
    tags: ["v*"]
jobs:
  publish:
    strategy:
      matrix:
        include:
          - os: macos-14      # Apple Silicon runner
            target: darwin-arm64
          - os: ubuntu-latest # x64 runner
            target: linux-x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "18" }
      - run: npm ci                       # pulls the runner's native lancedb binary
      - run: npm run build
      - run: npx @vscode/vsce publish --target ${{ matrix.target }}
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

Store the Marketplace PAT as the `VSCE_PAT` repo secret. Tagging `vX.Y.Z` then
publishes every target at that version in one go.

### 7. Release process update (small)

Update `RELEASING.md`: publishing is now per-target (or tag-driven via CI). All
supported targets must be published at the same version. Continue updating
`RELEASES.md` per the standing rule.

### 8. Testing on real Linux (medium, the real time sink)

On an actual Ubuntu x64 box or VM, verify end to end:
- Guided Ollama install (or detection of an existing install) and `ollama serve`.
- Model pull with progress.
- **Extension activation** (LanceDB `require` succeeds from the installed
  platform vsix) and that the "Knot" output channel appears.
- All four features: autocomplete, Cmd+K, chat, `@codebase`.
- Onboarding on a machine with no prior config.

### 9. Docs / listing (small)

Update README and the Marketplace copy to list Linux (x64, glibc: Ubuntu/Debian/
Fedora and similar). State clearly what is and is not supported.

## Scope decisions

- **Target `linux-x64` + glibc only** for this pass. Skip musl/Alpine and
  `linux-arm64` (add later if there is demand).
- **Keep `darwin-arm64`** as the other target. Intel Macs (`darwin-x64`) remain
  unsupported.
- GPU acceleration is entirely Ollama's responsibility (CUDA/ROCm/CPU on Linux);
  the extension needs no GPU code.

## Effort summary

| Chunk | Effort |
|-------|--------|
| Detection refactor (`os.totalmem()` + platform branch) | Small (~half day) |
| Ollama guided-install on Linux + binary path | Small |
| Onboarding copy + type tweaks | Small |
| Platform-specific vsix + CI matrix | Medium (main lift) |
| Real Linux testing | Medium (most calendar time) |
| Docs / listing | Small |

Roughly: about a day of code, with the packaging pipeline and real-device testing
being the bulk of the effort. Switching to `--target` publishing is worth doing
regardless, since it also fixes the "universal vsix ships the wrong binary"
problem for non-Mac installs.

## Later: Windows

Reuses most of the above (detection picker, guided install, `--target` pipeline),
plus Windows-specific work: `ollama.exe` on PATH, no `curl | sh` (guide to
`OllamaSetup.exe` / winget), and replacing the `/bin/sh` call in `runShell()`
with a cross-platform spawn. Add `--target win32-x64` to the CI matrix.
