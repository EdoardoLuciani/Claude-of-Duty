"use strict";

/**
 * gh-readonly.cjs — pi extension for the AI Review job.
 *
 * Gives the reviewer model a small set of ALLOWLISTED, READ-ONLY gh tools:
 * it can fetch the PR, the diff, the originating issue, and CI results
 * itself instead of receiving a pre-built prompt.
 *
 * Security properties:
 *  - Only the four tools below are registered. There is no arbitrary
 *    `gh api`/command passthrough and no bash tool in the review job, so a
 *    prompt-injected PR cannot make the reviewer execute anything.
 *  - All endpoints are read-only (GET). The token used is the read-only
 *    GITHUB_TOKEN of the review job.
 *  - Commands run via execFile with an argument array (no shell), and
 *    arguments are typed by the tool schemas.
 *  - Every tool call is appended to the REVIEW_TOOL_LOG audit file, which is
 *    uploaded as a workflow artifact.
 */

const { execFile } = require("child_process");
const fs = require("fs");

const REPO = process.env.GITHUB_REPOSITORY || "";
const AUDIT_LOG = process.env.REVIEW_TOOL_LOG || "/tmp/review-tool-calls.log";
const MAX_DIFF_BYTES = 250 * 1024;

function audit(entry) {
  try {
    fs.appendFileSync(AUDIT_LOG, `${new Date().toISOString()} ${entry}\n`);
  } catch {
    // auditing must never break the review
  }
}

function ghApi(args, maxBytes) {
  return new Promise(resolve => {
    execFile(
      "gh",
      ["api", ...args],
      { env: process.env, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ error: String(stderr || err.message).trim().slice(0, 500) });
          return;
        }
        let output = stdout;
        if (maxBytes && output.length > maxBytes) {
          output = output.slice(0, maxBytes) + "\n...[truncated]";
        }
        resolve({ output });
      }
    );
  });
}

async function run(pi, toolName, params) {
  const entry = `${toolName} ${JSON.stringify(params)}`;
  const result = await ghApi(params.args, params.maxBytes);
  audit(`${entry} -> ${result.error ? "ERROR " + result.error.slice(0, 200) : result.output.length + " bytes"}`);
  return {
    content: [{ type: "text", text: result.error ? `error: ${result.error}` : result.output }],
    details: {},
  };
}

module.exports = function (pi) {
  const { Type } = require("typebox");

  pi.registerTool({
    name: "gh_pr_view",
    label: "PR metadata",
    description: "Fetch metadata for a pull request: title, state, head SHA, base branch, labels, body. Use this first.",
    parameters: Type.Object({
      pr_number: Type.Number({ description: "Pull request number" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return run(pi, "gh_pr_view", {
        args: [`/repos/${REPO}/pulls/${params.pr_number}`, "--jq", "{number,title,state,draft,base:.base.ref,head_sha:.head.sha,labels:[.labels[].name],body}"],
      });
    },
  });

  pi.registerTool({
    name: "gh_pr_diff",
    label: "PR diff",
    description: "Fetch the complete unified diff of a pull request (base...head). Output is truncated at 250 KB.",
    parameters: Type.Object({
      pr_number: Type.Number({ description: "Pull request number" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return run(pi, "gh_pr_diff", {
        args: [`/repos/${REPO}/pulls/${params.pr_number}`, "-H", "Accept: application/vnd.github.diff"],
        maxBytes: MAX_DIFF_BYTES,
      });
    },
  });

  pi.registerTool({
    name: "gh_issue_view",
    label: "Issue view",
    description: "Fetch an issue: title, state, body, and the latest comments. Use for the originating issue of the PR.",
    parameters: Type.Object({
      issue_number: Type.Number({ description: "Issue number" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const head = await ghApi([
        `/repos/${REPO}/issues/${params.issue_number}`,
        "--jq",
        `"#" + (.number|tostring) + ": " + .title + "\\n\\n" + (.body // "(no body)")`,
      ]);
      const comments = await ghApi([
        `/repos/${REPO}/issues/${params.issue_number}/comments?per_page=20`,
        "--jq",
        "map(.body) | join(\"\\n\\n--- comment ---\\n\\n\")",
      ]);
      const text =
        (head.error ? `error: ${head.error}` : head.output) +
        (comments.error || !comments.output ? "" : `\n\n--- ISSUE COMMENTS ---\n\n${comments.output}`);
      audit(`gh_issue_view ${params.issue_number} -> ${text.length} bytes`);
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "gh_check_runs",
    label: "CI check runs",
    description: "Fetch the CI check runs for a commit SHA (name, status, conclusion). Use with the PR head SHA.",
    parameters: Type.Object({
      sha: Type.String({ description: "Commit SHA" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return run(pi, "gh_check_runs", {
        args: [`/repos/${REPO}/commits/${params.sha}/check-runs`, "--jq", ".check_runs[] | {name,status,conclusion}"],
      });
    },
  });
};
