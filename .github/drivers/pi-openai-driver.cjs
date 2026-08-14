#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

async function main() {
  const actionsDir = path.join(process.env.RUNNER_TEMP, "gh-aw/actions");
  const { fetchAWFReflect, resolveProviderEndpointFromReflect } = require(path.join(actionsDir, "awf_reflect.cjs"));
  const reflected = await fetchAWFReflect();
  const endpoint = reflected.ok && resolveProviderEndpointFromReflect({
    provider: "openai",
    reflectData: reflected.reflectData,
  });
  if (!endpoint) throw new Error("OpenAI-compatible gateway endpoint is unavailable");

  const configPath = path.join(process.env.PI_CODING_AGENT_DIR, "models.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const modelSpec = config.providers?.["aw-gateway"]?.models?.[0]?.id;
  if (!modelSpec) throw new Error("Pi gateway model configuration is missing");

  const [model, query = ""] = modelSpec.split("?", 2);
  const effort = new URLSearchParams(query).get("effort");
  const proxyExtension = path.join(process.env.PI_CODING_AGENT_DIR, "opencode-go-proxy.cjs");
  fs.writeFileSync(proxyExtension, `module.exports = pi => pi.registerProvider("opencode-go", { baseUrl: ${JSON.stringify(endpoint.baseUrl)} });\n`, { mode: 0o600 });
  if (!process.env.CODEX_API_KEY) throw new Error("CODEX_API_KEY is unavailable");
  process.env.OPENCODE_API_KEY = process.env.CODEX_API_KEY;
  process.env.OPENROUTER_API_KEY = fs.readFileSync(
    path.join(process.env.RUNNER_TEMP, "gh-aw/openrouter-api-key"), "utf8",
  );

  const args = [
    "--print", "--mode", "json", "--no-session", "--approve",
    "--model", `opencode-go/${model}`,
    "--extension", proxyExtension,
    "--extension", path.join(actionsDir, "pi_provider.cjs"),
    "--extension", path.join(actionsDir, "pi_steering_extension.cjs"),
  ];
  if (effort) args.push("--thinking", effort);
  const child = spawnSync("pi", args, {
    input: fs.readFileSync(process.env.GH_AW_PROMPT),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

main().catch(error => {
  console.error(`[pi-openai-driver] ${error.message}`);
  process.exitCode = 1;
});
