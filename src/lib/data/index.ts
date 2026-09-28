/**
 * Data-provider factory (brief §16). Selection order:
 *
 *   1. DEMO_DATA_MODE env ("mock" | "neon" | "core-api") — explicit override
 *   2. core-api when SYLLABAI_CORE_BASE_URL is set
 *   3. neon when NEON_DATABASE_URL / DATABASE_URL is set
 *   4. mock (always available — the hermetic default)
 */
import "server-only";
import type { DemoDataProvider } from "./types";
import { mockProvider } from "./mock";
import { coreApiProvider, isCoreApiConfigured } from "./core-api";

/**
 * Web adaptation (2026-09-28 import): the neon provider is NOT ported — a
 * frontend must never bypass the core domain layer (spec R5; the promotion
 * plan's Phase-0 call). Two modes remain: committed bundles (mock — the
 * default for the 39-course resource hubs) and core-api (the ladder the
 * 4CH1 pilot integration flips when core serves the hub's contracts).
 */
export type DataMode = "mock" | "core-api";

export function resolveDataMode(): DataMode {
  const forced = process.env.DEMO_DATA_MODE as DataMode | undefined;
  if (forced === "mock" || forced === "core-api") return forced;
  if (isCoreApiConfigured()) return "core-api";
  return "mock";
}

export function getDataProvider(): DemoDataProvider {
  switch (resolveDataMode()) {
    case "core-api":
      return coreApiProvider();
    default:
      return mockProvider();
  }
}
