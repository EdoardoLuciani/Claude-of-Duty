#!/usr/bin/env node
// @ts-check
"use strict";

/**
 * pi-opencode-go-driver.cjs — vendored gh-aw pi engine driver for OpenCode Go (BYOK)
 * ================================================================================
 *
 * This driver is the "external engine definition" for the implementation agent.
 * It is VENDORED into this repository (spec: do not import a mutable engine
 * definition from a floating `main` branch). It is adapted from:
 *
 *   github/gh-aw actions/setup/js/pi_agent_core_driver.cjs          (v0.85.4)
 *   github/gh-aw .github/drivers/pi_agent_core_driver_sample_node.cjs
 *
 * Differences from the upstream driver:
 *   1. Provider is `opencode-go` (https://opencode.ai/zen/go/v1) instead of the
 *      copilot/anthropic/openai backends. Model metadata below is copied from
 *      the pi-ai 0.84.1 bundled model catalog (providers/data/opencode-go.json)
 *      so it matches what the pi CLI itself would use.
 *   2. Reasoning effort is pinned to `max` (DeepSeek V4 Flash supports
 *      effort values low|high|max; `max` is the highest variant).
 *   3. The agent is given real tools (bash/read/write/edit) — the upstream
 *      driver registers none. The gh-aw MCP gateway exposes `safeoutputs` and
 *      `gh` as CLI wrappers on PATH; the bash tool can call them.
 *   4. The bash tool environment is scrubbed of credentials (API keys/tokens).
 *      The model key lives only in the driver process memory (getApiKey
 *      closure) and is never visible to the agent's shell.
 *   5. A hard turn cap (GH_AW_MAX_TURNS) aborts the session deterministically.
 *   6. A safe-output protocol check: the session must invoke the required safe
 *      output (create_pull_request for implementation,
 *      push_to_pull_request_branch for fixes) or the graceful-failure path
 *      (ai-needs-human + add-comment), otherwise the driver exits non-zero.
 *
 * Environment contract (all optional):
 *   GH_AW_PROMPT             path to the prompt file (required)
 *   GH_AW_PI_MODEL           "provider/model" string from gh-aw (prefix ignored;
 *                            only the model id is used as a fallback)
 *   GH_AW_MAX_TURNS          hard cap on agent turns (integer)
 *   AI_PI_MODEL              model id (default: deepseek-v4-flash)
 *   AI_PI_BASE_URL           provider base URL (default: https://opencode.ai/zen/go/v1)
 *   AI_PI_THINKING           reasoning effort level (default: max)
 *   AI_PI_API_KEY_ENV        name of the env var holding the OpenCode Go key
 *                            (default: CODEX_API_KEY; fallbacks: OPENCODE_API_KEY)
 *   AI_PI_REQUIRED_SAFE_OUTPUT   safe output that must be invoked before the
 *                            session ends (default: create_pull_request;
 *                            fix workflows: push_to_pull_request_branch)
 *   AI_PI_ALLOW_GRACEFUL_FAILURE when "true", a session that called add_labels
 *                            with ai-needs-human AND add_comment counts as
 *                            success without the required safe output
 *   GITHUB_WORKSPACE         working directory for the agent
 *
 * JSONL event protocol (compatible with gh-aw's parse_pi_log.cjs):
 *   { type: "init", model, session_id }
 *   { type: "assistant", content, delta }
 *   { type: "tool_use", tool_name, tool_id, parameters }
 *   { type: "tool_result", tool_id, status, output }
 *   { type: "result", stats: { input_tokens, output_tokens, duration_ms, turns } }
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

// The gh-aw runtime installs @earendil-works/pi-coding-agent globally and
// exposes it via NODE_PATH on the Execute step. ESM `import` does NOT honor
// NODE_PATH, so packages are located manually (resolvePackageRoot) and
// imported by absolute file URL.

function resolvePackageRoot(name) {
  // Both pi packages expose only an "import" condition in their exports map
  // and do not export ./package.json, so require.resolve cannot locate them.
  // Walk up from the driver's directory (local installs) and honor NODE_PATH
  // (the gh-aw runtime exports NODE_PATH pointing at the global npm root).
  const candidates = [];
  let dir = __dirname;
  for (;;) {
    candidates.push(path.join(dir, "node_modules", name));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const np of (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(np, name));
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "package.json"))) return c;
  }
  throw new Error(
    `cannot locate package ${name} — is @earendil-works/pi-coding-agent installed? ` +
      `(NODE_PATH=${process.env.NODE_PATH || "(unset)"})`
  );
}

async function importPackage(name, subpath = "dist/index.js") {
  const root = resolvePackageRoot(name);
  return import(pathToFileURL(path.join(root, subpath)).href);
}

function packageVersion(name) {
  const root = resolvePackageRoot(name);
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
}

// ---------------------------------------------------------------------------
// Logging / JSONL helpers
// ---------------------------------------------------------------------------

/** @param {string} msg */
function log(msg) {
  process.stderr.write(`[pi-opencode-go-driver] ${new Date().toISOString()} ${msg}\n`);
}

/** @param {unknown} obj */
function emitJsonl(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_THINKING = "max"; // DeepSeek V4 Flash reasoning effort: low | high | max

function env(name, fallback = "") {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const cfg = {
  promptFile: env("GH_AW_PROMPT"),
  model: env("AI_PI_MODEL", DEFAULT_MODEL),
  baseUrl: env("AI_PI_BASE_URL", DEFAULT_BASE_URL),
  thinking: env("AI_PI_THINKING", DEFAULT_THINKING),
  apiKeyEnv: env("AI_PI_API_KEY_ENV", "CODEX_API_KEY"),
  requiredSafeOutput: env("AI_PI_REQUIRED_SAFE_OUTPUT", "create_pull_request"),
  allowGracefulFailure: env("AI_PI_ALLOW_GRACEFUL_FAILURE", "false") === "true",
  maxTurns: Number.parseInt(env("GH_AW_MAX_TURNS", "0"), 10) || 0,
  workspace: env("GITHUB_WORKSPACE", process.cwd()),
};

const ghAwModel = env("GH_AW_PI_MODEL", "");
const ghAwModelId = ghAwModel.includes("/") ? ghAwModel.slice(ghAwModel.indexOf("/") + 1) : ghAwModel;

// ---------------------------------------------------------------------------
// API key resolution — the key lives ONLY in this closure. It is never written
// to the agent's environment (the bash tool env is scrubbed, see below).
// ---------------------------------------------------------------------------

function getApiKey(provider) {
  if (provider === "opencode-go") {
    return process.env[cfg.apiKeyEnv] || process.env.OPENCODE_API_KEY || process.env.CODEX_API_KEY;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Model metadata — copied from pi-ai 0.84.1 bundled catalog
// (node_modules/@earendil-works/pi-ai/dist/providers/data/opencode-go.json,
//  openai-completions.deepseek-v4-flash). Verified against models.dev:
// reasoning options for deepseek-v4-flash are effort low|high|max.
// ---------------------------------------------------------------------------

function buildModel() {
  const modelId = cfg.model || ghAwModelId || DEFAULT_MODEL;
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "opencode-go",
    baseUrl: cfg.baseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
    contextWindow: 1000000,
    maxTokens: 384000,
    // pi thinking level -> provider reasoning effort. `max` is supported and
    // is the highest variant exposed by DeepSeek V4 Flash.
    thinkingLevelMap: { minimal: null, low: null, medium: null, high: "high", max: "max" },
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const SENSITIVE_ENV_RE =
  /(API_KEY|ACCESS_KEY|SECRET|PASSWORD|PRIVATE_KEY|GITHUB_TOKEN|GITHUB_PAT|COPILOT_GITHUB_TOKEN|GH_AW_GITHUB_TOKEN|GH_AW_GITHUB_MCP_SERVER_TOKEN|MCP_GATEWAY_API_KEY)/i;

/**
 * Scrub the bash tool environment: the agent's shell must not see API keys or
 * tokens. gh-aw's `safeoutputs` and `gh` CLI wrappers carry their own
 * credentials (embedded at generation time), so they keep working without any
 * secret env vars.
 *
 * @param {import("@earendil-works/pi-agent-core").BashExecution} execution
 */
function scrubBashEnv(execution) {
  execution.cwd = cfg.workspace;
  execution.inheritEnv = false;
  execution.env = scrubbedEnv();
  // Ensure the tool environment still has the basics.
  if (execution.env.PATH === undefined) execution.env.PATH = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  if (execution.env.HOME === undefined) execution.env.HOME = process.env.HOME || "/root";
  if (execution.env.RUNNER_TEMP === undefined) execution.env.RUNNER_TEMP = process.env.RUNNER_TEMP || "";
}

/**
 * Adapt an AgentHarnessTool (execute takes a trailing context arg) to the
 * AgentTool shape the Agent expects (context bound at construction time).
 *
 * @param {import("@earendil-works/pi-agent-core").AgentHarnessTool<any>} tool
 * @param {object} context
 */
function adaptTool(tool, context) {
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate) =>
      tool.execute(toolCallId, params, signal, onUpdate, context),
  };
}

function scrubbedEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !SENSITIVE_ENV_RE.test(key))
  );
}

async function buildTools() {
  // The harness/tools subpath is not part of the package "exports" map in
  // 0.84.1. The version is pinned by engine.version in the workflow
  // (pi-coding-agent@0.84.1 -> pi-agent-core ^0.84.1), so the dist path is
  // stable. A version mismatch is reported loudly instead of failing silently.
  const coreVersion = packageVersion("@earendil-works/pi-agent-core");
  if (!/^0\.84\./.test(coreVersion)) {
    log(`WARNING: @earendil-works/pi-agent-core version ${coreVersion} differs from the pinned 0.84.x line; deep imports may break.`);
  }

  const { createBashTool, createReadTool, createWriteTool, createEditTool } = await importPackage(
    "@earendil-works/pi-agent-core",
    "dist/harness/tools/index.js"
  );

  // NodeExecutionEnv provides the filesystem + shell abstraction the harness
  // tools expect. The shell env is scrubbed of credentials: API keys and
  // tokens never reach the agent's shell, while gh-aw's `safeoutputs` and
  // `gh` CLI wrappers keep working (their credentials are embedded in the
  // wrappers, not in the environment).
  const { NodeExecutionEnv } = await importPackage(
    "@earendil-works/pi-agent-core",
    "dist/harness/env/nodejs.js"
  );
  const nodeEnv = new NodeExecutionEnv({
    cwd: cfg.workspace,
    shellEnv: scrubbedEnv(),
  });
  const context = { env: nodeEnv };
  return [
    adaptTool(createBashTool({ prepare: scrubBashEnv }), context),
    adaptTool(createReadTool(), context),
    adaptTool(createWriteTool(), context),
    adaptTool(createEditTool(), context),
  ];
}

// ---------------------------------------------------------------------------
// Safe-output protocol tracking
// ---------------------------------------------------------------------------

const requestedSafeOutputs = new Set();
let safeOutputFailed = false;

function trackToolCall(toolName, args) {
  const name = String(toolName || "").toLowerCase();
  const command = String((args && typeof args === "object" && args.command) || "").toLowerCase();
  const haystack = `${name} ${command}`;
  // gh-aw exposes safe outputs as CLI tools (e.g. `safeoutputs
  // create_pull_request --base develop ...`) which the agent invokes through
  // its bash tool. Match the tool name AND the bash command text.
  for (const key of ["create_pull_request", "push_to_pull_request_branch", "add_comment", "add_labels", "remove_labels"]) {
    if (haystack.includes(key)) {
      requestedSafeOutputs.add(key);
    }
  }
}

function protocolSatisfied() {
  if (requestedSafeOutputs.has(cfg.requiredSafeOutput)) return true;
  if (cfg.allowGracefulFailure && requestedSafeOutputs.has("add_comment") && requestedSafeOutputs.has("add_labels")) {
    // The agent must have called add_labels with ai-needs-human; we cannot
    // inspect arguments here, so require the comment as well. The deterministic
    // label allowlist still restricts which labels it could have applied.
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  if (!cfg.promptFile) {
    throw new Error("GH_AW_PROMPT is not set");
  }
  let prompt;
  try {
    prompt = fs.readFileSync(cfg.promptFile, "utf8");
  } catch (err) {
    throw new Error(`failed to read prompt file ${cfg.promptFile}: ${err.message}`);
  }
  if (!prompt.trim()) {
    throw new Error(`prompt file ${cfg.promptFile} is empty`);
  }
  if (!getApiKey("opencode-go")) {
    throw new Error(
      `OpenCode Go API key not found: expected env var ${cfg.apiKeyEnv} (fallbacks: OPENCODE_API_KEY, CODEX_API_KEY). ` +
        `Configure the GitHub Actions secret the gh-aw pi engine expects (see docs/ai-pipeline/MANUAL-SETUP.md).`
    );
  }

  const model = buildModel();
  const tools = await buildTools();

  log(
    `starting: model=${model.id} baseUrl=${model.baseUrl} thinking=${cfg.thinking} ` +
      `maxTurns=${cfg.maxTurns} requiredSafeOutput=${cfg.requiredSafeOutput} workspace=${cfg.workspace}`
  );

  const { Agent, setDefaultStreamFn } = await importPackage("@earendil-works/pi-agent-core");
  // Register all built-in providers (openai-completions, anthropic-messages,
  // ...) and route requests through the Models stream helper. The opencode-go
  // provider is part of the built-in catalog in pi-ai 0.84.x.
  const { builtinModels } = await importPackage("@earendil-works/pi-ai", "dist/providers/all.js");
  const models = builtinModels();
  setDefaultStreamFn(models.streamSimple.bind(models));

  const sessionId = crypto.randomUUID();
  const startTimeMs = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let turns = 0;
  let maxTurnsHit = false;

  const agent = new Agent({
    initialState: {
      // The gh-aw prompt contains all task instructions and context; the
      // system prompt is intentionally left empty (same as upstream).
      systemPrompt: "",
      model,
      thinkingLevel: cfg.thinking,
      tools,
    },
    getApiKey,
  });

  agent.subscribe(event => {
    switch (event.type) {
      case "agent_start":
        emitJsonl({ type: "init", model: `${model.provider}/${model.id}`, session_id: sessionId });
        break;
      case "message_update": {
        const ae = event.assistantMessageEvent;
        if (ae && ae.type === "text_delta") {
          emitJsonl({ type: "assistant", content: ae.delta, delta: true });
        }
        break;
      }
      case "tool_execution_start": {
        trackToolCall(event.toolName, event.args);
        emitJsonl({
          type: "tool_use",
          tool_name: event.toolName,
          tool_id: event.toolCallId,
          parameters: event.args ?? {},
        });
        break;
      }
      case "tool_execution_end": {
        if (event.isError) safeOutputFailed = true;
        const output =
          typeof event.result === "string"
            ? event.result
            : event.result !== null && event.result !== undefined
              ? JSON.stringify(event.result)
              : "";
        emitJsonl({
          type: "tool_result",
          tool_id: event.toolCallId,
          status: event.isError ? "error" : "success",
          output,
        });
        break;
      }
      case "turn_end": {
        turns++;
        const msg = event.message;
        if (msg && typeof msg === "object" && msg.usage && typeof msg.usage === "object") {
          inputTokens += typeof msg.usage.input === "number" ? msg.usage.input : 0;
          outputTokens += typeof msg.usage.output === "number" ? msg.usage.output : 0;
        }
        if (cfg.maxTurns > 0 && turns >= cfg.maxTurns) {
          maxTurnsHit = true;
          log(`max turns reached (${turns}); aborting agent session`);
          agent.abort();
        }
        break;
      }
      case "agent_end":
        emitJsonl({
          type: "result",
          stats: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            duration_ms: Date.now() - startTimeMs,
            turns,
          },
        });
        break;
      default:
        break;
    }
  });

  await agent.prompt(prompt);
  await agent.waitForIdle();

  const durationMs = Date.now() - startTimeMs;
  log(
    `session complete: session_id=${sessionId} turns=${turns} input_tokens=${inputTokens} ` +
      `output_tokens=${outputTokens} duration_ms=${durationMs} safeOutputs=${[...requestedSafeOutputs].join(",") || "(none)"}`
  );

  // Deterministic protocol enforcement (fail closed).
  if (maxTurnsHit) {
    log("FAIL: max turns exceeded — the agent did not complete within the allowed budget.");
    process.exit(1);
  }
  if (safeOutputFailed) {
    log("FAIL: a tool execution failed (likely a safe-output call).");
    process.exit(1);
  }
  if (!protocolSatisfied()) {
    log(
      `FAIL: session ended without invoking the required safe output "${cfg.requiredSafeOutput}" ` +
        `(and without the graceful ai-needs-human failure path). The branch was not delivered.`
    );
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write(`[pi-opencode-go-driver] unhandled error: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}

module.exports = { buildModel, getApiKey, scrubBashEnv, adaptTool };
