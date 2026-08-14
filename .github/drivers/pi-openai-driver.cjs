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
  const provider = config.providers?.["aw-gateway"];
  if (!provider) throw new Error("Pi gateway provider configuration is missing");
  provider.baseUrl = endpoint.baseUrl;
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });

  const model = provider.models?.[0]?.id;
  if (!model) throw new Error("Pi model configuration is missing");
  const child = spawnSync("pi", [
    "--print", "--mode", "json", "--no-session",
    "--model", `aw-gateway/${model}`,
    "--extension", path.join(actionsDir, "pi_provider.cjs"),
    "--extension", path.join(actionsDir, "pi_steering_extension.cjs"),
  ], {
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
