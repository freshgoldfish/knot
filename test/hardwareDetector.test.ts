import { describe, expect, it } from "vitest";

import {
  applyDiskFallback,
  linuxCpuLabel,
  mapMemoryToTier,
  modelsForTier,
  parseChip,
  parseIsAppleSilicon,
  parseMacosMajor,
} from "../src/services/hardwareDetector";

describe("mapMemoryToTier", () => {
  // Boundary table (HARDWARE_PROFILES.md, 36GB -> Tier 3 locked 2026-06-01).
  it.each([
    [8, 1],
    [12, 1],
    [15, 1],
    [16, 2], // Tier 2 lower boundary
    [18, 2], // real M3 Pro base config
    [23, 2],
    [24, 3], // Tier 3 lower boundary
    [32, 3],
    [36, 3], // the contested boundary — resolves to Tier 3
    [37, 4], // first value above the boundary
    [48, 4],
    [64, 4],
    [128, 4],
  ])("maps %iGB to Tier %i", (gb, tier) => {
    expect(mapMemoryToTier(gb)).toBe(tier);
  });
});

describe("applyDiskFallback", () => {
  it("keeps the tier when disk is sufficient", () => {
    expect(applyDiskFallback(4, 100)).toBe(4);
    expect(applyDiskFallback(3, 20)).toBe(3);
  });

  it("falls back from Tier 4 to Tier 3 below the 30GB floor", () => {
    expect(applyDiskFallback(4, 20)).toBe(3);
  });

  it("steps down multiple tiers when disk is very low", () => {
    // 20GB free: fails Tier 4 (30) and Tier 3 (14)? 20 >= 14 so stops at 3.
    expect(applyDiskFallback(4, 20)).toBe(3);
    // 5GB free: fails 4 (30), 3 (14), 2 (8) -> lands on Tier 1.
    expect(applyDiskFallback(4, 5)).toBe(1);
  });

  it("never falls below Tier 1", () => {
    expect(applyDiskFallback(1, 0)).toBe(1);
    expect(applyDiskFallback(4, 0)).toBe(1);
  });
});

describe("parseIsAppleSilicon", () => {
  it.each([
    ["Apple M1", true],
    ["Apple M2 Pro", true],
    ["Apple M3 Max", true],
    ["Apple M4", true],
    ["Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz", false],
    ["", false],
  ])("classifies %j as appleSilicon=%s", (brand, expected) => {
    expect(parseIsAppleSilicon(brand)).toBe(expected);
  });
});

describe("parseChip", () => {
  it.each([
    ["Apple M1", "M1", "base"],
    ["Apple M2 Pro", "M2", "Pro"],
    ["Apple M3 Max", "M3", "Max"],
    ["Apple M1 Ultra", "M1", "Ultra"],
    ["Apple M4 Pro", "M4", "Pro"],
  ])("parses %j", (brand, generation, variant) => {
    expect(parseChip(brand)).toEqual({ generation, variant });
  });

  it("returns unknown for an unrecognised brand", () => {
    expect(parseChip("Intel(R) Core(TM) i7")).toEqual({
      generation: "unknown",
      variant: "unknown",
    });
  });
});

describe("parseMacosMajor", () => {
  it.each([
    ["14.5", 14],
    ["13.0", 13],
    ["12.7.1", 12],
    ["15", 15],
  ])("parses %j to %i", (version, major) => {
    expect(parseMacosMajor(version)).toBe(major);
  });

  it("returns 0 for an unparseable version", () => {
    expect(parseMacosMajor("not-a-version")).toBe(0);
  });
});

describe("linuxCpuLabel", () => {
  it("uses the CPU model when present", () => {
    expect(linuxCpuLabel("AMD Ryzen 7 5800X 8-Core Processor", "x64")).toBe(
      "AMD Ryzen 7 5800X 8-Core Processor",
    );
    expect(linuxCpuLabel("  Intel(R) Core(TM) i7-9750H  ", "x64")).toBe(
      "Intel(R) Core(TM) i7-9750H",
    );
  });

  it("falls back to an arch label when the model is missing or blank", () => {
    expect(linuxCpuLabel(undefined, "x64")).toBe("Linux (x64)");
    expect(linuxCpuLabel("", "arm64")).toBe("Linux (arm64)");
    expect(linuxCpuLabel("   ", "x64")).toBe("Linux (x64)");
  });
});

describe("modelsForTier", () => {
  it("returns the correct model set per tier (HARDWARE_PROFILES.md)", () => {
    expect(modelsForTier(1)).toEqual({
      chat: "qwen2.5-coder:1.5b",
      autocomplete: "qwen2.5-coder:1.5b",
      embedding: "nomic-embed-text",
    });
    expect(modelsForTier(2)).toEqual({
      chat: "qwen2.5-coder:7b",
      autocomplete: "qwen2.5-coder:1.5b",
      embedding: "nomic-embed-text",
    });
    expect(modelsForTier(3)).toEqual({
      chat: "qwen2.5-coder:14b",
      autocomplete: "qwen2.5-coder:3b",
      embedding: "nomic-embed-text",
    });
    expect(modelsForTier(4)).toEqual({
      chat: "qwen2.5-coder:32b",
      autocomplete: "qwen2.5-coder:3b",
      embedding: "nomic-embed-text",
    });
  });
});
