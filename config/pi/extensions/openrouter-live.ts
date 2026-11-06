// @ts-nocheck
/**
 * openrouter-live — keep pi's OpenRouter model list in step with OpenRouter itself.
 *
 * WHY THIS EXISTS
 * pi's built-in OpenRouter provider can only *filter* the catalog it ships by the
 * key's `/models/user` list; it can never *add* an id the catalog does not know
 * (`personalizeOpenRouterCatalog` ends in a `flatMap` that drops unknown chat ids).
 * A model OpenRouter starts serving between pi.dev catalog regenerations therefore
 * stays invisible until that catalog is regenerated or pi is upgraded.
 *
 * HOW IT WORKS
 * This extension registers a *native* provider for `openrouter`. The model registry
 * prefers a native extension provider over the built-in one, so this file owns the
 * openrouter entry (`ModelRegistry.composeProvider`). It reproduces what the built-in
 * does — merge the bundled catalog with the pi.dev catalog when newer, then filter
 * chat models by the key's `/models/user` list and refresh their context window,
 * output limit and prices — and adds the one thing the built-in cannot do: synthesize
 * entries for key-usable ids that no catalog knows, by inheriting compatibility
 * metadata (`compat`, `thinkingLevelMap`, `inputLimits`, `promptCache`) from the
 * closest same-family catalog model. Image and classifier models pass through
 * untouched, so the built-in generation and classification paths keep working.
 *
 * Refresh runs on the runtime's own schedule — startup, `/model`, `/login`,
 * `pi update --models` — first with the stored credential and `allowNetwork: false`
 * (restore the persisted snapshot, offline-safe), then with the resolved credential
 * and `allowNetwork: true`. No timers, sockets or watchers are started here.
 *
 * ENV SWITCHES
 *   OPENROUTER_LIVE_DISABLE=1          do not register; keep built-in behavior
 *   OPENROUTER_LIVE_SYNTH=off          keep filter + metadata refresh, no synthesis
 *   OPENROUTER_LIVE_REQUIRE_TOOLS=0    also synthesize models without tool calling
 *   OPENROUTER_LIVE_CATALOG_BASE_URL=  override the catalog base URL (default https://pi.dev)
 *
 * LIMITATIONS
 *   - A synthesized model's metadata is inferred. Only ids with a same-family catalog
 *     model are synthesized, and `input` follows the live modalities intersected with
 *     the donor's, so reasoning/image behavior stays as close to the known model as
 *     possible. Unknown families are skipped and only reported.
 *   - Synthesized entries are not refreshed by pi's own catalog pipeline; this file
 *     refreshes them on every network refresh, so prices follow `/models/user`.
 *   - Video/audio modalities and `:batch`/`:free` routing variants are not synthesized.
 */

import { builtinProviders, getBuiltinClassifierModels, getBuiltinImageModels, getBuiltinModelDataGeneratedAt, getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

const PROVIDER_ID = "openrouter";
const DEFAULT_CATALOG_BASE = "https://pi.dev";
const CATALOG_TIMEOUT_MS = 15000;
const USER_MODELS_TIMEOUT_MS = 15000;
const MAX_FAMILY_STRIPS = 3;
const SYNTH_MODES = new Set(["donor", "off"]);

const DISABLED = process.env.OPENROUTER_LIVE_DISABLE === "1";
const SYNTH_MODE = (process.env.OPENROUTER_LIVE_SYNTH ?? "donor").toLowerCase();
const REQUIRE_TOOLS = process.env.OPENROUTER_LIVE_REQUIRE_TOOLS !== "0";
const CATALOG_BASE = (process.env.OPENROUTER_LIVE_CATALOG_BASE_URL ?? DEFAULT_CATALOG_BASE).replace(/\/+$/, "");
const REASONING_PARAMS = ["reasoning", "reasoning_effort", "include_reasoning"];
const DEBUG = process.env.OPENROUTER_LIVE_DEBUG === "1";
const debug = (...args) => {
  if (DEBUG) console.warn("[openrouter-live]", ...args);
};

/** Live list owned by this extension: what `getModels()`/`getAllModels()` return. */
const state = {
  chat: [],
  image: [],
  classifier: [],
  provenance: new Map(),
  report: { source: "uninitialized", allowed: 0, matched: 0, synthesized: [], skipped: {} },
  loadedAt: 0,
};

const isChat = (model) => (model?.type ?? "chat") === "chat";
const typeKey = (model) => `${model?.type ?? "chat"}\u0000${model?.id}`;

/** Same merge rule as pi: dedupe by model type and id, later entries win. */
function mergeCatalog(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const model of group ?? []) {
      if (model && typeof model.id === "string") merged.set(typeKey(model), model);
    }
  }
  return [...merged.values()];
}

function perMillion(value, fallback) {
  const perToken = Number.parseFloat(value ?? "");
  return Number.isFinite(perToken) && perToken >= 0 ? Number((perToken * 1e6).toFixed(6)) : fallback;
}

/** Mirrors pi's `openRouterCost`: negative placeholder prices never become negative. */
function openRouterCost(pricing) {
  const base = {
    input: perMillion(pricing?.prompt, 0),
    output: perMillion(pricing?.completion, 0),
    cacheRead: perMillion(pricing?.input_cache_read, 0),
    cacheWrite: perMillion(pricing?.input_cache_write, 0),
  };
  const tiers = (pricing?.overrides ?? []).flatMap((override) => {
    if (
      override?.min_prompt_tokens === undefined ||
      override.utc_start !== undefined ||
      override.utc_end !== undefined ||
      override.utc_days !== undefined
    ) {
      return [];
    }
    return [
      {
        inputTokensAbove: override.min_prompt_tokens,
        input: perMillion(override.prompt, base.input),
        output: perMillion(override.completion, base.output),
        cacheRead: perMillion(override.input_cache_read, base.cacheRead),
        cacheWrite: perMillion(override.input_cache_write, base.cacheWrite),
      },
    ];
  });
  return tiers.length > 0 ? { ...base, tiers } : base;
}

const liveContextWindow = (entry, fallback) =>
  entry?.top_provider?.context_length || entry?.context_length || fallback;
const liveMaxTokens = (entry, fallback) => entry?.top_provider?.max_completion_tokens || fallback;

/** Refresh the fields `/models/user` is authoritative for; keep everything else. */
function applyLive(model, entry) {
  return {
    ...model,
    contextWindow: liveContextWindow(entry, model.contextWindow),
    maxTokens: liveMaxTokens(entry, model.maxTokens),
    cost: entry?.pricing ? openRouterCost(entry.pricing) : model.cost,
  };
}

/** Progressively drop trailing segments: `deepseek/deepseek-v4.1-flash-1017` → `…-flash`. */
function familyCandidates(id) {
  const slash = id.indexOf("/");
  if (slash < 0) return [];
  const vendor = id.slice(0, slash);
  let rest = id.slice(slash + 1);
  const out = [];
  for (let i = 0; i < MAX_FAMILY_STRIPS && rest.includes("-"); i++) {
    rest = rest.replace(/-[^-]+$/, "");
    if (!rest) break;
    out.push(`${vendor}/${rest}`);
  }
  return out;
}

function findDonor(id, catalogById) {
  for (const candidate of familyCandidates(id)) {
    const donor = catalogById.get(candidate);
    if (donor && isChat(donor) && donor.api && donor.provider === PROVIDER_ID) return donor;
  }
  return undefined;
}

function supportsReasoning(entry, donor) {
  const params = entry?.supported_parameters;
  if (!Array.isArray(params)) return donor.reasoning ?? false;
  if (params.some((name) => REASONING_PARAMS.includes(name))) return true;
  return false;
}

function synthesize(entry, donor) {
  const reasoning = supportsReasoning(entry, donor);
  const modalities = entry?.architecture?.input_modalities;
  const input = Array.isArray(modalities)
    ? ["text", ...(modalities.includes("image") && (donor.input ?? []).includes("image") ? ["image"] : [])]
    : donor.input ?? ["text"];
  return {
    type: "chat",
    id: entry.id,
    name: entry.name ?? donor.name ?? entry.id,
    api: donor.api,
    baseUrl: donor.baseUrl,
    provider: PROVIDER_ID,
    reasoning,
    thinkingLevelMap: reasoning ? donor.thinkingLevelMap : undefined,
    input,
    inputLimits: input.includes("image") ? donor.inputLimits : undefined,
    cost: entry.pricing ? openRouterCost(entry.pricing) : donor.cost,
    promptCache: donor.promptCache,
    contextWindow: liveContextWindow(entry, donor.contextWindow),
    maxTokens: liveMaxTokens(entry, donor.maxTokens),
    compat: donor.compat,
  };
}

function chatCapable(entry) {
  const output = entry?.architecture?.output_modalities;
  if (Array.isArray(output) && !output.includes("text")) return false;
  if (!REQUIRE_TOOLS) return true;
  const params = entry?.supported_parameters;
  if (!Array.isArray(params)) return true;
  return params.includes("tools") || params.includes("tool_choice");
}

/** Build the effective list: catalog ∩ key, refreshed, plus donor-backed additions. */
function compose(merged, allowed) {
  const chatCatalog = merged.filter(isChat);
  const catalogById = new Map(chatCatalog.map((model) => [model.id, model]));
  const provenance = new Map();
  const synthesized = [];
  const skipped = { notInCatalog: 0, noFamily: 0, notChat: 0, routingVariant: 0 };
  const chat = [];

  for (const model of chatCatalog) {
    if (!allowed) {
      chat.push(model);
      provenance.set(model.id, "catalog");
      continue;
    }
    const entry = allowed.get(model.id);
    if (!entry) continue; // the key may not use it — same as the built-in filter
    chat.push(applyLive(model, entry));
    provenance.set(model.id, "catalog");
  }

  if (allowed && SYNTH_MODE === "donor") {
    for (const [id, entry] of allowed) {
      if (catalogById.has(id)) continue;
      if (id.includes(":")) {
        skipped.routingVariant++;
        continue;
      }
      if (!chatCapable(entry)) {
        skipped.notChat++;
        continue;
      }
      const donor = findDonor(id, catalogById);
      if (!donor) {
        skipped.noFamily++;
        continue;
      }
      chat.push(synthesize(entry, donor));
      provenance.set(id, `synth:${donor.id}`);
      synthesized.push({ id, donor: donor.id });
    }
  }

  return {
    chat,
    provenance,
    report: {
      source: allowed ? (SYNTH_MODE === "donor" ? "catalog+user+synth" : "catalog+user") : "catalog",
      allowed: allowed ? allowed.size : 0,
      matched: chat.length - synthesized.length,
      synthesized,
      skipped,
    },
  };
}

function install(models, provenance, report, source) {
  state.chat = models.filter(isChat);
  state.image = models.filter((model) => model.type === "image");
  state.classifier = models.filter((model) => model.type === "classifier");
  if (provenance) state.provenance = provenance;
  if (report) state.report = { ...report, source };
  if (!provenance) state.provenance = new Map(models.map((model) => [model.id, "restored"]));
  state.loadedAt = Date.now();
}

async function fetchJson(url, init, signal, timeoutMs) {
  const response = await fetch(url, {
    ...init,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  return response;
}

/** `/models/user` — the key's usable list. `null` means "do not filter" (as pi does). */
async function fetchUserModels(baseUrl, key, signal) {
  const response = await fetchJson(
    `${baseUrl.replace(/\/+$/, "")}/models/user`,
    { headers: { accept: "application/json", authorization: `Bearer ${key}` } },
    signal,
    USER_MODELS_TIMEOUT_MS,
  );
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`OpenRouter model list request failed: ${response.status}`);
  const body = await response.json();
  if (typeof body !== "object" || body === null || !Array.isArray(body.data)) {
    throw new Error("Invalid OpenRouter model list response");
  }
  const allowed = new Map();
  for (const entry of body.data) {
    if (entry && typeof entry.id === "string") allowed.set(entry.id, entry);
  }
  return allowed;
}

/** Bundled catalog merged with the pi.dev catalog, gated like pi gates it. */
async function loadCatalog(signal, builtin, builtinGeneratedAt) {
  let remote = [];
  let lastModified;
  try {
    const url = new URL(`/api/models/providers/${PROVIDER_ID}`, `${CATALOG_BASE}/`);
    url.searchParams.set("types", "chat,image,classifier");
    const response = await fetchJson(
      url,
      { headers: { accept: "application/json" } },
      signal,
      CATALOG_TIMEOUT_MS,
    );
    if (response.ok) {
      const parsed = Date.parse(response.headers.get("last-modified") ?? "");
      lastModified = Number.isNaN(parsed) ? undefined : parsed;
      const newer = builtinGeneratedAt === undefined || (lastModified !== undefined && lastModified > builtinGeneratedAt);
      if (newer) {
        const body = await response.json();
        const entries = Array.isArray(body) ? body : body?.models ?? Object.values(body ?? {});
        remote = (Array.isArray(entries) ? entries : []).filter((model) => model && typeof model.id === "string");
      }
    } else if (response.status !== 404 && response.status !== 501) {
      throw new Error(`catalog request failed: ${response.status}`);
    }
  } catch (error) {
    if (signal?.aborted) return undefined;
    console.warn(`[openrouter-live] pi.dev catalog unavailable (${error?.message ?? error}); keeping the previous list`);
    return undefined;
  }
  return { models: mergeCatalog(builtin, remote), lastModified, usedRemote: remote.length > 0 };
}

export default async function (pi) {
  debug(`factory: loading (synth=${SYNTH_MODE}, requireTools=${REQUIRE_TOOLS}, catalogBase=${CATALOG_BASE})`);
  if (DISABLED) {
    console.warn("[openrouter-live] disabled via OPENROUTER_LIVE_DISABLE=1");
    return;
  }
  if (!SYNTH_MODES.has(SYNTH_MODE)) {
    console.warn(`[openrouter-live] unknown OPENROUTER_LIVE_SYNTH=${SYNTH_MODE}; falling back to "donor"`);
  }

  let ai;
  try {
    ai = await import("@earendil-works/pi-ai/providers/all");
  } catch (error) {
    console.warn(
      "[openrouter-live] cannot import @earendil-works/pi-ai/providers/all; keeping the built-in OpenRouter provider:",
      error?.message ?? error,
    );
    return;
  }

  const base = (ai.builtinProviders?.() ?? []).find((provider) => provider.id === PROVIDER_ID);
  if (!base || typeof base.getModels !== "function" || !base.auth) {
    console.warn("[openrouter-live] built-in OpenRouter provider not reachable; leaving it in place");
    return;
  }

  const builtin = [
    ...(ai.getBuiltinModels?.(PROVIDER_ID) ?? []),
    ...(ai.getBuiltinImageModels?.(PROVIDER_ID) ?? []),
    ...(ai.getBuiltinClassifierModels?.(PROVIDER_ID) ?? []),
  ];
  const builtinGeneratedAt = ai.getBuiltinModelDataGeneratedAt?.();

  async function refreshModels(context) {
    const restored = (context.stored?.models ?? []).filter((model) => model?.provider === PROVIDER_ID);
    debug(`refresh: allowNetwork=${context.allowNetwork} credential=${context.credential?.type ?? "none"} stored=${restored.length}`);
    if (restored.length > 0) {
      const published = await context.publish({ update: () => install(restored, undefined, undefined, "restored") });
      if (!published) return;
    }
    if (!context.allowNetwork || context.signal?.aborted) return;

    const catalog = await loadCatalog(context.signal, builtin, builtinGeneratedAt);
    debug(`catalog: ${catalog === undefined ? "unavailable" : `${catalog.models.length} entries, remote=${catalog.usedRemote}`}`);
    if (catalog === undefined) {
      // Keep the previous snapshot instead of regressing to the bundled catalog.
      if (context.stored) {
        await context.publish({ persist: { ...context.stored, checkedAt: Date.now() } });
      }
      return;
    }

    const credential = context.credential;
    const key = credential?.type === "oauth" ? credential.access : credential?.key;
    let allowed;
    if (key) {
      allowed = await fetchUserModels(context.baseUrl ?? base.baseUrl, key, context.signal);
      if (context.signal?.aborted) return;
    }

    const composed = compose(catalog.models, allowed);
    debug(
      `compose: key-usable=${composed.report.allowed} matched=${composed.report.matched} synthesized=${composed.report.synthesized.length} skipped=${JSON.stringify(composed.report.skipped)}`,
    );
    debug(`synthesized: ${composed.report.synthesized.map((item) => `${item.id}<-${item.donor}`).join(", ") || "(none)"}`);
    const models = [...composed.chat, ...catalog.models.filter((model) => model.type === "image"), ...catalog.models.filter((model) => model.type === "classifier")];
    await context.publish({
      persist: {
        models,
        checkedAt: Date.now(),
        catalogLastModified: catalog.lastModified,
        synthesized: composed.report.synthesized,
      },
      update: () =>
        install(
          models,
          composed.provenance,
          { ...composed.report, source: catalog.usedRemote ? "bundled+pi.dev" : "bundled" },
          catalog.usedRemote ? "bundled+pi.dev" : "bundled",
        ),
    });
  }

  try {
    pi.registerProvider({
      ...base,
      getModels: () => state.chat,
      getAllModels: () => [...state.chat, ...state.image, ...state.classifier],
      refreshModels,
    });
  } catch (error) {
    console.warn("[openrouter-live] provider registration failed; keeping the built-in provider:", error?.message ?? error);
    return;
  }

  pi.registerCommand("openrouter-sync", {
    description: "Refresh the OpenRouter model list now and report synthesized models",
    handler: async (_args, ctx) => {
      let errors;
      try {
        const result = await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], force: true });
        errors = result?.errors;
      } catch (error) {
        ctx.ui?.notify?.(`OpenRouter refresh failed: ${error?.message ?? error}`, "error");
        return;
      }
      const { report } = state;
      const skippedTotal = Object.values(report.skipped ?? {}).reduce((sum, count) => sum + count, 0);
      const lines = [
        `source ${report.source} · ${state.chat.length} chat · ${state.image.length} image · ${state.classifier.length} classifier`,
        `key-usable ${report.allowed} · from catalog ${report.matched} · synthesized ${report.synthesized.length} · skipped ${skippedTotal}`,
      ];
      for (const item of report.synthesized.slice(0, 10)) lines.push(`  + ${item.id} ← ${item.donor}`);
      if (report.synthesized.length > 10) lines.push(`  … ${report.synthesized.length - 10} more`);
      const skipped = Object.entries(report.skipped ?? {}).filter(([, count]) => count > 0);
      if (skipped.length > 0) lines.push(`  skipped: ${skipped.map(([reason, count]) => `${reason}=${count}`).join(" ")}`);
      if (errors?.size) lines.push(`  refresh errors: ${[...errors.keys()].join(", ")}`);
      if (!errors && state.loadedAt === 0) lines.push("  note: no model list yet");
      ctx.ui?.notify?.(lines.join("\n"), errors?.size ? "error" : "info");
    },
  });

  pi.registerCommand("openrouter-explain", {
    description: "Show where an OpenRouter model entry comes from (catalog, pi.dev, or synthesized)",
    handler: async (args, ctx) => {
      const id = (args ?? "").trim();
      if (!id) {
        ctx.ui?.notify?.("Usage: /openrouter-explain <model-id>", "error");
        return;
      }
      const model = [...state.chat, ...state.image, ...state.classifier].find((entry) => entry.id === id);
      if (!model) {
        ctx.ui?.notify?.(`${id} is not in the current OpenRouter list`, "error");
        return;
      }
      const provenance = state.provenance.get(id) ?? "unknown";
      const lines = [
        `${model.id} (${model.type ?? "chat"})`,
        `source: ${provenance}`,
        `api: ${model.api} · reasoning: ${model.reasoning ?? false} · input: ${(model.input ?? []).join("+") || "text"}`,
        `context ${model.contextWindow} · max out ${model.maxTokens} · cost ${JSON.stringify(model.cost)}`,
      ];
      if (provenance.startsWith("synth:")) {
        lines.push(`inherited compat: ${JSON.stringify(model.compat ?? {})}`);
        lines.push(`inherited thinking: ${JSON.stringify(model.thinkingLevelMap ?? {})}`);
      }
      ctx.ui?.notify?.(lines.join("\n"), "info");
    },
  });
}
