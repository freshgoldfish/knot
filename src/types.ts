// Shared types for Knot. Kept free of any `vscode` import so every
// service that uses these types stays unit-testable under Vitest.

/** Hardware tier (HARDWARE_PROFILES.md). Drives model selection. */
export type Tier = 1 | 2 | 3 | 4;

export type ChipGeneration = "M1" | "M2" | "M3" | "M4" | "unknown";
export type ChipVariant = "base" | "Pro" | "Max" | "Ultra" | "unknown";

/** Platforms Knot supports (DECISIONS 001 + 018). */
export type SupportedPlatform = "darwin" | "linux";

/** Result of HardwareDetector.detect(). */
export interface HardwareProfile {
  /**
   * OS family this profile was detected on. `darwin` uses chip/Metal detection;
   * `linux` uses RAM-based tiering only (Phase 9, DECISIONS 018).
   */
  platform: SupportedPlatform;
  /** False for unsupported hardware (Intel Macs, non-macOS/Linux platforms). */
  supported: boolean;
  /** User-facing reason when `supported` is false. */
  unsupportedReason?: string;
  /** True only on Apple Silicon Macs; always false on Linux. */
  isAppleSilicon: boolean;
  /**
   * Chip label. On macOS, the raw `machdep.cpu.brand_string` (e.g. "Apple M3
   * Pro"); on Linux, the CPU model from `os.cpus()` (e.g. "AMD Ryzen 7 5800X").
   */
  chipBrand: string;
  chipGeneration: ChipGeneration;
  chipVariant: ChipVariant;
  /** Total physical memory in GiB, rounded (unified memory on Apple Silicon). */
  totalMemoryGB: number;
  /** Free disk in GiB on the home volume. */
  availableDiskGB: number;
  /** macOS product version, e.g. "14.5". Empty on Linux. */
  macosVersion: string;
  /** Major version number, e.g. 14. Zero on Linux. */
  macosMajor: number;
  /** Metal GPU acceleration available (macOS 13+). Always false on Linux. */
  metalSupported: boolean;
  /** Chosen tier after RAM mapping + disk fallback. */
  tier: Tier;
  /** True when detection failed and we defaulted to Tier 2. */
  detectionFailed: boolean;
}

/** The three models a tier uses (HARDWARE_PROFILES.md). */
export interface ModelSet {
  chat: string;
  autocomplete: string;
  embedding: string;
}

/** Per-workspace index state. Populated in Phase 2; open-ended for now. */
export interface WorkspaceIndexState {
  indexed?: boolean;
  fileCount?: number;
  workspaceHash?: string;
}

/** Persisted config.json schema (PHASES.md Phase 1). */
export interface KnotConfig {
  onboardingComplete: boolean;
  /**
   * Last completed onboarding step (0-based), used to resume an interrupted
   * setup (PHASES.md Phase 6 / ONBOARDING_FLOW.md). 0 when not started; the
   * resume logic that consumes it lands with the onboarding UI (WP2 PR B).
   */
  onboardingStep: number;
  tier: Tier | null;
  chatModel: string | null;
  autocompleteModel: string | null;
  embeddingModel: string | null;
  workspaceIndexes: Record<string, WorkspaceIndexState>;
  /** Inline (FIM) completions toggle, flipped from the chat panel (Phase 4). */
  inlineCompletionsEnabled: boolean;
}

// ----------------------------------------------------------------------------
// Codebase indexing (PHASES.md Phase 2 / DATA_FLOW.md §5–6)
// ----------------------------------------------------------------------------

/** A contiguous slice of a source file produced by the Chunker. */
export interface CodeChunk {
  /** Absolute path of the source file (canonical key for delete/update). */
  filename: string;
  /** 1-based first line of the slice (inclusive). */
  startLine: number;
  /** 1-based last line of the slice (inclusive). */
  endLine: number;
  /** The slice text. */
  text: string;
}

/** A chunk retrieved from the index, with its rerank scoring (0–1 each). */
export interface RetrievedChunk extends CodeChunk {
  /** Vector similarity derived from LanceDB distance (1 = closest). */
  similarity: number;
  /** Recency score from the file's mtime (1 = just modified). */
  recency: number;
  /** Combined rerank score: 0.7×similarity + 0.3×recency (DATA_FLOW §4). */
  score: number;
}

/** Progress emitted while indexing a workspace. */
export interface IndexProgress {
  /** Files processed so far (1-based). */
  current: number;
  /** Total files to process. */
  total: number;
  /** The file currently being processed, when known. */
  filename?: string;
}

/** Summary returned by IndexManager.indexWorkspace(). */
export interface IndexStats {
  fileCount: number;
  chunkCount: number;
  workspaceHash: string;
}

/** Minimal logging surface so services don't depend on vscode.OutputChannel. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

/** A single chat message in the Ollama /api/chat format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ----------------------------------------------------------------------------
// Sidebar chat (PHASES.md Phase 3 / FEATURES.md §3 / DATA_FLOW.md §3)
// ----------------------------------------------------------------------------

/**
 * Automatic context about the user's active editor, injected silently into the
 * chat prompt (FEATURES.md §3 "Automatic Context"). Gathered by the chat view
 * provider; consumed by the PromptEngine.
 */
export interface FileContext {
  /** Path of the active file, workspace-relative for display. */
  filename: string;
  /** VS Code language identifier, e.g. "typescript". */
  languageId: string;
  /** File contents, omitted when the file exceeds the line limit. */
  content?: string;
  /** 1-based cursor line, when an editor is focused. */
  cursorLine?: number;
  /** Currently selected text, if any. */
  selectedText?: string;
}

/** Ollama sampling options (passed through to /api/chat and /api/generate). */
export interface OllamaRequestOptions {
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

/** Progress event emitted while pulling a model. */
export interface PullProgress {
  /** Ollama's status text, e.g. "pulling manifest", "downloading". */
  status: string;
  /** 0–100 when a percentage is present on the line. */
  percent?: number;
}
