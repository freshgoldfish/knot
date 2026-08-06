# Release History

Version history for **Knot AI** (`freshgoldfish.knot-ai`) on the VS Code Marketplace.

Marketplace listing: https://marketplace.visualstudio.com/items?itemName=freshgoldfish.knot-ai

| Version | Date | PR | Summary |
|---------|------|----|---------|
| [v0.1.7](#v017) | 2026-08-06 | #28–30 | Linux (x64) support; platform-specific builds |
| [v0.1.6](#v016) | 2026-07-11 | #25 | Repo moved to the freshgoldfish org; publish updated repository URL |
| [v0.1.5](#v015) | 2026-07-11 | #22, #23 | Credit Keisha Kaba & Shobhit Sinha as developers in the README |
| [v0.1.4](#v014) | 2026-07-11 | #18 | Stylistic changes to README + marketplace description |
| [v0.1.3](#v013) | 2026-07-11 | #17 | Listing polish: README banner, intro copy, release docs |
| [v0.1.2](#v012) | 2026-07-11 | #16 | Critical fix: bundle runtime deps so the extension activates |
| [v0.1.1](#v011) | 2026-07-11 | #15 | Initial launch on the VS Code Marketplace |

---

## v0.1.7

First **Linux (x64, glibc)** release (Phase 9). Hardware detection is now
platform-aware (Linux uses RAM-based tiering via `os.totalmem()`, no chip/Metal
probing), onboarding guides Linux users to install Ollama (the Linux installer
needs sudo, so it isn't run headlessly), and releases now ship platform-specific
builds (`darwin-arm64` + `linux-x64`) via a CI matrix. macOS is unaffected. See
`docs/PLATFORMS.md` and DECISIONS 018.

## v0.1.6

Repository moved into the `freshgoldfish` GitHub org (co-owned by Keisha Kaba and Shobhit Sinha). Published so the updated `freshgoldfish/knot` repository URL, and the "Repository" link on the listing, go live. No functional code changes.

## v0.1.5

Added a "Built by Keisha Kaba & Shobhit Sinha" developer credit near the top of the README, rendered as plain Markdown so it displays consistently on GitHub and the Marketplace listing. Version bump to publish the updated README.

## v0.1.4

**Stylistic changes** to the README and the marketplace description. Copy-only; no functional code changes.

## v0.1.3

Marketplace listing polish:

- New README banner and refreshed intro copy.
- Added the long-form logo asset (`media/knot-logo-long.jpg`).
- Added the internal release runbook (`docs/RELEASING.md`).

## v0.1.2

Critical activation fix. The initial published `.vsix` shipped without its LanceDB / Apache Arrow runtime dependencies, so the extension failed to activate on install. Fixed by bundling `apache-arrow`, `flatbuffers`, and `tslib` (via `.vscodeignore`).

## v0.1.1

Initial public release. First publish of Knot AI to the VS Code Marketplace at the end of Phase 8.
