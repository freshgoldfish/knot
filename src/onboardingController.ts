import { OLLAMA_DOWNLOAD_URL } from "./constants";
import { HardwareDetector, modelsForTier } from "./services/hardwareDetector";
import type { ConfigManager } from "./services/configManager";
import type { ContextService } from "./contextService";
import type { OllamaService } from "./services/ollamaService";
import type { HardwareProfile, Logger, ModelSet } from "./types";
import type { OnboardingActionId, OnboardingView } from "./webviewProtocol";

// Drives the first-run onboarding flow rendered in the chat webview (Phase 6
// WP2, ONBOARDING_FLOW.md, DECISIONS 017). `vscode`-coupled glue: it sequences
// the same operations the headless setup used (hardware → models → Ollama →
// pulls → index) but reports each as an OnboardingView the webview renders, and
// pauses at the user gates (Get Started, Download Models, Start Coding).

/** Total onboarding steps (0 Welcome … 6 Ready). */
const TOTAL_STEPS = 7;

/**
 * Rough remaining-time estimate from elapsed time and percent complete, for the
 * download progress screen. Pure (elapsed is passed in, not read from a clock)
 * so it is unit-tested directly. Returns undefined when there's nothing
 * meaningful to show (not started, or done).
 */
export function formatEta(
  elapsedMs: number,
  percent: number,
): string | undefined {
  if (percent <= 0 || percent >= 100) return undefined;
  const remainingMs = (elapsedMs / percent) * (100 - percent);
  const mins = Math.round(remainingMs / 60000);
  if (mins >= 1)
    return `about ${mins} minute${mins === 1 ? "" : "s"} remaining`;
  const secs = Math.max(5, Math.round(remainingMs / 1000));
  return `about ${secs}s remaining`;
}

/** Heuristic: does this error look like the disk filled up during a download? */
export function isDiskSpaceError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("no space") ||
    msg.includes("disk") ||
    msg.includes("enospc") ||
    msg.includes("space left")
  );
}

/** Rough on-disk sizes for the download consent screen (ONBOARDING_FLOW.md). */
const MODEL_SIZES: Record<string, string> = {
  "qwen2.5-coder:1.5b": "~1 GB",
  "qwen2.5-coder:3b": "~2 GB",
  "qwen2.5-coder:7b": "~4.7 GB",
  "qwen2.5-coder:14b": "~9 GB",
  "qwen2.5-coder:32b": "~20 GB",
  "nomic-embed-text": "~0.3 GB",
};

export interface OnboardingDeps {
  ollama: OllamaService;
  config: ConfigManager;
  contextService: ContextService | undefined;
  logger: Logger;
  /** Send a screen to the webview. */
  post: (view: OnboardingView) => void;
  /** Register inline completions + the index watcher once setup completes. */
  finalize: () => Promise<void>;
  /** Swap the webview from onboarding to the normal chat UI. */
  showChat: () => void;
}

type Phase = "welcome" | "models" | "downloading" | "ready" | "running";

/** Persisted onboarding-step checkpoints, for resuming an interrupted setup. */
const STEP_WELCOME = 0;
const STEP_MODELS = 2; // hardware detected, awaiting download consent
const STEP_DOWNLOADING = 3; // consented; downloading/indexing
const STEP_READY = 6; // everything done, awaiting "Start Coding"

export class OnboardingController {
  private phase: Phase = "welcome";
  private hw?: HardwareProfile;
  private models?: ModelSet;

  constructor(private readonly deps: OnboardingDeps) {}

  /**
   * Entry point when the webview is ready (and setup isn't complete). Resumes
   * from the last persisted step rather than always restarting at Welcome
   * (ONBOARDING_FLOW.md §"Resuming Interrupted Onboarding").
   */
  begin(): void {
    const step = this.deps.config.get().onboardingStep ?? STEP_WELCOME;
    if (step <= STEP_WELCOME) {
      this.showWelcome();
    } else {
      this.deps.logger.info(`Resuming onboarding from step ${step}.`);
      void this.resume(step);
    }
  }

  /** Handle a button press from the webview. */
  async handleAction(id: OnboardingActionId): Promise<void> {
    if (id === "getStarted" && this.phase === "welcome") {
      await this.runDetectAndSelect();
    } else if (id === "downloadModels" && this.phase === "models") {
      await this.runDownloadAndIndex();
    } else if (id === "startCoding" && this.phase === "ready") {
      await this.finish();
    } else if (id === "retry") {
      await this.retry();
    }
  }

  // --- Steps ---------------------------------------------------------------

  private showWelcome(): void {
    this.phase = "welcome";
    this.persistStep(STEP_WELCOME);
    this.deps.post({
      step: 0,
      total: TOTAL_STEPS,
      title: "Welcome to Knot",
      detail:
        "We'll set everything up for you — about 5–15 minutes, mostly the " +
        "one-time model download. After that it all runs offline, and nothing " +
        "you type ever leaves your machine.",
      mode: "prompt",
      actionId: "getStarted",
      actionLabel: "Get Started",
    });
  }

  /**
   * Resume an interrupted setup. Re-detecting hardware and re-running downloads
   * is safe and cheap: present models are skipped (hasModel) and Ollama resumes
   * partial downloads. Before the download consent we re-show that gate; after
   * it, we continue straight through (the user already consented).
   */
  private async resume(step: number): Promise<void> {
    this.phase = "running";
    this.info(step, "Resuming setup…", "Picking up where you left off.");
    try {
      if (!(await this.detect())) return; // terminal (e.g. unsupported hardware)
      if (step < STEP_DOWNLOADING) {
        this.postModelsConsent();
      } else {
        await this.runDownloadAndIndex();
      }
    } catch (err) {
      this.deps.logger.error("Onboarding resume failed", err);
      this.error(step, "Setup hit a snag", "Couldn't resume setup.", true);
    }
  }

  /** Step 0 → 2: detect hardware, then show the model-selection consent screen. */
  private async runDetectAndSelect(): Promise<void> {
    this.phase = "running";
    try {
      if (await this.detect()) this.postModelsConsent();
    } catch (err) {
      this.deps.logger.error("Onboarding hardware step failed", err);
      this.error(1, "Setup hit a snag", "Couldn't detect your hardware.", true);
    }
  }

  /** Detect hardware + pick models. Returns false (after posting) if terminal. */
  private async detect(): Promise<boolean> {
    this.info(
      1,
      "Detecting your hardware…",
      "Checking memory, disk, and chip.",
    );
    const hw = await new HardwareDetector(this.deps.logger).detect();
    if (!hw.supported) {
      this.error(
        1,
        "Unsupported hardware",
        hw.unsupportedReason ??
          "Knot v1 supports Apple Silicon only. Intel support is coming.",
        false, // terminal — no retry
      );
      return false;
    }
    this.hw = hw;
    this.models = modelsForTier(hw.tier);
    await this.deps.config.update({
      tier: hw.tier,
      chatModel: this.models.chat,
      autocompleteModel: this.models.autocomplete,
      embeddingModel: this.models.embedding,
      onboardingStep: 1,
    });
    return true;
  }

  private postModelsConsent(): void {
    if (!this.hw || !this.models) return;
    this.phase = "models";
    this.persistStep(STEP_MODELS);
    const m = this.models;
    this.deps.post({
      step: 2,
      total: TOTAL_STEPS,
      title: "Models selected for your machine",
      detail:
        `Detected ${this.hw.chipBrand} · ${this.hw.totalMemoryGB}GB ` +
        `(Tier ${this.hw.tier}).\n\n` +
        `• Chat: ${m.chat} (${MODEL_SIZES[m.chat] ?? "?"})\n` +
        `• Autocomplete: ${m.autocomplete} (${MODEL_SIZES[m.autocomplete] ?? "?"})\n` +
        `• Embeddings: ${m.embedding} (${MODEL_SIZES[m.embedding] ?? "?"})`,
      mode: "prompt",
      actionId: "downloadModels",
      actionLabel: "Download Models",
    });
  }

  /** Steps 3–5: ensure Ollama, download models, index the workspace. */
  private async runDownloadAndIndex(): Promise<void> {
    if (!this.models) return this.runDetectAndSelect();
    this.phase = "downloading";
    this.persistStep(STEP_DOWNLOADING);
    const { ollama, contextService } = this.deps;

    // Step 3 — install Ollama. A permission failure gets a manual-install link
    // + "I've installed it" retry (ONBOARDING_FLOW.md Step 3 error state).
    if (!ollama.isInstalled()) {
      // On platforms where we can't install headlessly (Linux needs sudo), guide
      // the user to install Ollama themselves rather than auto-running the script
      // (Phase 9, DECISIONS 018). "I've installed it" re-enters this step.
      if (!ollama.canAutoInstall()) {
        this.errorWithLink(
          3,
          "Install Ollama to continue",
          "Knot runs models locally through Ollama. Install it for your system, " +
            "then come back and click below.",
          "I've installed it",
          { label: "Open ollama.com/download", url: OLLAMA_DOWNLOAD_URL },
        );
        return;
      }
      this.info(3, "Installing Ollama…", "This takes about 30 seconds.");
      try {
        await ollama.install();
      } catch (err) {
        this.deps.logger.error("Onboarding: Ollama install failed", err);
        this.errorWithLink(
          3,
          "Couldn't install Ollama automatically",
          "This usually needs permission. Install Ollama manually, then come " +
            "back and click below.",
          "I've installed it",
          { label: "Open ollama.com/download", url: OLLAMA_DOWNLOAD_URL },
        );
        return;
      }
    }
    try {
      if (!(await ollama.isRunning())) {
        this.info(3, "Starting Ollama…", "Bringing up the local model server.");
        await ollama.start();
      }

      // Step 4 — model downloads with progress + ETA.
      await this.pull(this.models.chat, "chat model");
      await this.pull(this.models.autocomplete, "autocomplete model");
      await this.pull(this.models.embedding, "embedding model");

      // Step 5 — index the workspace.
      let fileCount = 0;
      if (contextService) {
        this.info(
          5,
          "Indexing your codebase…",
          "Reading your project for context-aware chat.",
        );
        const stats = await contextService.indexWorkspace((p) => {
          const percent =
            p.total > 0 ? Math.round((p.current / p.total) * 100) : 0;
          this.deps.post({
            step: 5,
            total: TOTAL_STEPS,
            title: "Indexing your codebase…",
            detail: `${p.current} of ${p.total} files indexed`,
            mode: "progress",
            percent,
          });
        });
        fileCount = stats.fileCount;
        this.deps.logger.info(
          `Onboarding indexed ${stats.fileCount} files, ${stats.chunkCount} chunks.`,
        );
      }

      this.showReady(fileCount);
    } catch (err) {
      this.deps.logger.error("Onboarding download/index step failed", err);
      if (isDiskSpaceError(err)) {
        // Step 4 disk-full error state — explain and stop (no blind retry).
        this.error(
          4,
          "Not enough disk space",
          "Downloading the models ran out of disk space. Free up a few GB " +
            "(the models need several GB) and re-run setup.",
          false,
        );
      } else {
        this.error(
          4,
          "Setup hit a snag",
          "A download or indexing step failed. You can retry — Ollama resumes " +
            "partial downloads where it left off.",
          true,
        );
      }
    }
  }

  /** Step 6 — the ready screen, noting when no code files were found. */
  private showReady(fileCount: number): void {
    this.phase = "ready";
    this.persistStep(STEP_READY);
    const noFiles =
      fileCount === 0
        ? "No code files were found here, so @codebase has nothing to search " +
          "yet — chat still works.\n\n"
        : "";
    this.deps.post({
      step: 6,
      total: TOTAL_STEPS,
      title: "Knot is ready",
      detail:
        noFiles +
        "Try it:\n• Pause while typing for inline autocomplete\n" +
        "• Ask a question here in chat\n" +
        "• Type @codebase before a question to search your project\n\n" +
        "Everything runs on your machine.",
      mode: "ready",
      actionId: "startCoding",
      actionLabel: "Start Coding",
    });
  }

  /** Step 6 → done: persist completion, light up features, show chat. */
  private async finish(): Promise<void> {
    await this.deps.config.update({
      onboardingComplete: true,
      onboardingStep: STEP_READY,
    });
    this.deps.logger.info("Onboarding complete.");
    try {
      await this.deps.finalize();
    } catch (err) {
      this.deps.logger.error("Onboarding finalize failed", err);
    }
    this.deps.showChat();
  }

  /** Re-run whichever phase failed. */
  private async retry(): Promise<void> {
    if (this.phase === "models" || this.phase === "running") {
      await this.runDetectAndSelect();
    } else {
      await this.runDownloadAndIndex();
    }
  }

  // --- Helpers -------------------------------------------------------------

  private async pull(model: string, label: string): Promise<void> {
    if (await this.deps.ollama.hasModel(model)) return; // already present
    const started = Date.now();
    let lastPercent = -1;
    await this.deps.ollama.pullModel(model, (progress) => {
      if (progress.percent === undefined || progress.percent === lastPercent) {
        return;
      }
      lastPercent = progress.percent;
      this.deps.post({
        step: 4,
        total: TOTAL_STEPS,
        title: `Downloading ${label}…`,
        detail: `${model} — ${progress.status}`,
        mode: "progress",
        percent: progress.percent,
        eta: this.eta(started, progress.percent),
      });
    });
  }

  private info(step: number, title: string, detail: string): void {
    this.deps.post({ step, total: TOTAL_STEPS, title, detail, mode: "info" });
  }

  /**
   * Persist the resume checkpoint without blocking the UI. Fire-and-forget, but
   * guarded: a config write can reject (disk full / read-only home), and an
   * unhandled rejection would be worse than a lost checkpoint.
   */
  private persistStep(step: number): void {
    void this.deps.config
      .update({ onboardingStep: step })
      .catch((err) =>
        this.deps.logger.warn(
          `Couldn't persist onboarding step: ${String(err)}`,
        ),
      );
  }

  private error(
    step: number,
    title: string,
    detail: string,
    retry: boolean,
  ): void {
    this.deps.post({
      step,
      total: TOTAL_STEPS,
      title,
      detail,
      mode: "error",
      actionId: retry ? "retry" : undefined,
      actionLabel: retry ? "Try Again" : undefined,
    });
  }

  /** Error screen with a retry button plus an external link (manual install). */
  private errorWithLink(
    step: number,
    title: string,
    detail: string,
    retryLabel: string,
    link: { label: string; url: string },
  ): void {
    this.deps.post({
      step,
      total: TOTAL_STEPS,
      title,
      detail,
      mode: "error",
      actionId: "retry",
      actionLabel: retryLabel,
      link,
    });
  }

  /** Remaining-time estimate for the download screen (see {@link formatEta}). */
  private eta(startedMs: number, percent: number): string | undefined {
    return formatEta(Date.now() - startedMs, percent);
  }
}
