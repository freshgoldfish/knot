# Model Picker Plan

Status: **proposal / plan** (not yet implemented). Scopes a user-facing control
to change the model from the chat header, on top of the automatic
tier-based selection.

Related docs: [`HARDWARE_PROFILES.md`](./HARDWARE_PROFILES.md),
[`UI_UX.md`](./UI_UX.md), [`DATA_FLOW.md`](./DATA_FLOW.md), [`PHASES.md`](./PHASES.md) (Phase 10).

## Goal

Let the user override the auto-detected model with a **dropdown in the chat
header, next to New Chat**, choosing from the curated `qwen2.5-coder` sizes.
Detection still picks a sensible default; this is an override for users who want
something faster or more capable than their tier suggests.

## Where it lands

The chat header (`src/chatViewProvider.ts`, the `getHtml` `<header>` block)
already contains: the `Knot` wordmark, a `model-name` span that currently only
*displays* the active chat model, a **New Chat** button, and the **Autocomplete**
toggle. The picker upgrades that `model-name` span into an interactive control in
the same row, so it sits right beside New Chat.

## Design (preset sizes)

A `<select>` (or small popup menu) lists profiles that each map to a tier's model
set (from `TIER_MODELS` in `src/constants.ts`):

| Label | chat model | autocomplete model |
|-------|------------|--------------------|
| 1.5B (fastest) | qwen2.5-coder:1.5b | qwen2.5-coder:1.5b |
| 3B | qwen2.5-coder:3b | qwen2.5-coder:3b |
| 7B (balanced) | qwen2.5-coder:7b | qwen2.5-coder:1.5b |
| 14B | qwen2.5-coder:14b | qwen2.5-coder:3b |
| 32B (most capable) | qwen2.5-coder:32b | qwen2.5-coder:3b |

Selecting a profile updates `chatModel` + `autocompleteModel` in config. Both the
chat provider and the completion provider **read their model from config live**
(per message / per request), so the change takes effect immediately once the
model is present. No provider re-registration is required.

## Decision to resolve: embeddings and re-index

An earlier answer asked for "all three roles (including embeddings, forces a
re-index)." But the presets do not vary embeddings: `nomic-embed-text` is the
embedding model at **every** tier (a constant, `EMBEDDING_MODEL`). So with preset
sizes:

- Only **chat + autocomplete** change.
- **Embeddings never change, so no re-index is ever triggered.**

**Recommendation:** the picker changes chat + autocomplete only; embeddings stay
fixed. Swapping the embedding model is a separate, heavier feature (different
model options, a forced full re-index, and index-compatibility handling) that a
size dropdown does not cover. Revisit only if there is real demand.

## Work breakdown

1. **Webview UI** (small to medium). Turn the `model-name` span into a dropdown:
   render the preset list, mark the current selection, disable it during
   onboarding and while a switch is in flight.
2. **Protocol** (small). Add a `setModel` message (webview to host) and extend
   the `init` message to carry the preset list + current selection; validate the
   new message in `parseWebviewMessage` (`src/webviewProtocol.ts`).
3. **Provider logic** (medium). On select: persist the new models to config, then
   **pull the chat + autocomplete models if not already installed**. Chat and
   completions pick up the new models from config automatically.
4. **Download UX (the main lift).** Switching to a not-yet-installed size (32B is
   ~20 GB) is a multi-minute download, and the chat header has no progress
   surface today. Decide how to show it (a VS Code notification with a progress
   bar is the simplest, native option; an inline header indicator is nicer but
   more webview work), handle disk-space failure, handle the user switching
   mid-download, and block sending until the model is ready.
5. **Edge cases.** Pull failure reverts the selection and shows an error;
   guard against concurrent switches; persist the choice; decide whether picking
   a model marks config as a manual override vs. the detected `tier` (store the
   chosen models directly; keep `tier` as informational).

## Effort

The dropdown plus config wiring is roughly half a day. The
download-with-progress-and-failure UX is the bulk (about 1 to 2 days) and is the
part worth designing carefully.

## Open decisions before building

1. **Embeddings:** confirm chat + autocomplete only (recommended), or truly allow
   embedding-model swapping (bigger scope, forces re-index).
2. **Download progress surface:** native VS Code notification with a progress bar
   (simplest) vs. an inline header indicator (nicer, more work).
3. **Labels:** raw sizes ("7B") vs. friendly labels ("Balanced, 7B, ~4.7 GB").
4. **Cross-platform note:** on Linux the model still downloads via Ollama the same
   way; nothing platform-specific here (see PLATFORMS.md).
