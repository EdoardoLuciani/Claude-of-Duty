#!/usr/bin/env python3
"""AI Review pipeline controller helpers.

Subcommands (used by .github/workflows/ai-review.yml):

  resolve   --run-id ID --head-sha SHA [--pr-number N]
            Deterministic eligibility + state resolution. Writes state.json
            with action = review | ci-fix | skip.

  parse     --raw review-raw.txt --state state.json --out review.json
            Validates the reviewer's structured output. Exit 1 on invalid
            output (FAIL CLOSED).

  publish   --state state.json [--review review.json | --ci-fix ci.json]
            Posts the result comment and manages labels (deterministic).

All commands run with gh (GH_TOKEN env) and use only read endpoints except
publish, which requires issues/pull-requests write permission.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

REPO = os.environ.get("GITHUB_REPOSITORY", "")
BASE_BRANCH = "develop"
HEAD_PREFIX = "agent/"
MAX_FIX_ROUNDS = 2  # spec: maximum initial review/fix rounds
REVIEW_MARKER = "<!-- ai-review-result -->"
CI_FAILURE_MARKER = "<!-- ai-ci-failure -->"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def gh(*args, check=True):
    p = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(f"gh api {' '.join(args)} failed: {p.stderr[:500]}")
    return p


def gh_json(*args, check=True):
    p = gh(*args + ["--jq", "."], check=check)
    if p.returncode != 0 or not p.stdout.strip():
        return None
    return json.loads(p.stdout)


def gh_list(*args):
    """Parse one page of a listing endpoint; [] on failure."""
    out = gh(*args, check=False)
    if out.returncode != 0:
        return []
    return json.loads(out.stdout or "[]")


def pr_from_head_sha(head_sha):
    """Find an open PR whose head is exactly head_sha. Returns None or dict."""
    data = gh_json(f"/repos/{REPO}/commits/{head_sha}/pulls")
    if not data:
        return None
    for pr in data:
        if (pr.get("state") == "open" and pr.get("head", {}).get("sha") == head_sha):
            return pr
    return None


def pr_labels(pr_number):
    data = gh_json(f"/repos/{REPO}/issues/{pr_number}/labels")
    return {label.get("name") for label in (data or [])}


def count_fix_rounds_simple(pr_number):
    """Deterministic counter: labeled events with ai-fix-needed on the timeline."""
    count = 0
    page = 1
    while True:
        events = gh_list(f"/repos/{REPO}/issues/{pr_number}/timeline?per_page=100&page={page}")
        if not events:
            break
        for ev in events:
            if ev.get("event") == "labeled" and ev.get("label", {}).get("name") == "ai-fix-needed":
                count += 1
        if len(events) < 100:
            break
        page += 1
    return count


def extract_issue_number(pr_body):
    m = re.search(r"(?:Fixes|Closes|Resolves)\s+#(\d+)", pr_body or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


def comment(pr_number, body):
    p = gh(
        "-X", "POST", f"/repos/{REPO}/issues/{pr_number}/comments",
        "-f", "body=" + body,
        check=False,
    )
    if p.returncode != 0:
        print(f"WARNING: could not post comment on #{pr_number}: {p.stderr[:300]}")


def add_labels(pr_number, *labels):
    for label in labels:
        gh("-X", "POST", f"/repos/{REPO}/issues/{pr_number}/labels",
           "-f", "name=" + label, check=False)


def remove_label(pr_number, label):
    gh("-X", "DELETE", f"/repos/{REPO}/issues/{pr_number}/labels/{label}", check=False)


def load_state(path):
    with open(path) as f:
        return json.load(f)


def save_state(state, path):
    with open(path, "w") as f:
        json.dump(state, f, indent=2)


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------


def bail(state, args, reason):
    state["reason"] = reason
    save_state(state, args.out)
    print(json.dumps(state))
    return 0


def cmd_resolve(args):
    state = {
        "action": "skip",
        "reason": "",
        "pr_number": None,
        "head_sha": args.head_sha,
        "head_ref": None,
        "issue_number": None,
        "ci_conclusion": None,
        "ci_run_url": None,
        "failed_jobs": [],
    }

    run = None
    if args.run_id:
        run = gh_json(f"/repos/{REPO}/actions/runs/{args.run_id}")
        if run:
            state["ci_conclusion"] = run.get("conclusion")
            state["ci_run_url"] = run.get("html_url")

    pr = None
    if args.pr_number:
        pr = gh_json(f"/repos/{REPO}/pulls/{args.pr_number}")
    if pr is None:
        pr = pr_from_head_sha(args.head_sha)
    if pr is None:
        return bail(state, args, "no open PR found for head sha")

    state["pr_number"] = pr["number"]
    state["head_ref"] = pr["head"]["ref"]
    state["head_sha"] = pr["head"]["sha"]
    state["pr_title"] = pr.get("title", "")

    # --- PROVENANCE (spec section 18): trust chain checks -----------------
    base = (pr.get("base") or {}).get("ref")
    head_ref = pr["head"]["ref"]
    head_repo = ((pr.get("head") or {}).get("repo") or {}).get("full_name")

    if base != BASE_BRANCH:
        return bail(state, args, f"PR base is '{base}', not '{BASE_BRANCH}'")
    if not head_ref.startswith(HEAD_PREFIX):
        return bail(state, args, f"PR head '{head_ref}' does not start with '{HEAD_PREFIX}'")
    if head_repo != REPO:
        return bail(state, args, f"PR head repo '{head_repo}' is not '{REPO}'")
    if pr.get("draft"):
        return bail(state, args, "PR is a draft")

    labels = pr_labels(pr["number"])
    if "ai-pr-open" not in labels:
        return bail(state, args, "PR lacks the ai-pr-open label (not created by the trusted pipeline)")
    if labels & {"ai-needs-human", "ai-failed"}:
        return bail(state, args, f"PR is in a terminal state: {sorted(labels & {'ai-needs-human', 'ai-failed'})}")

    # Originating issue must have been authorized by the owner (ai-ready).
    issue_number = extract_issue_number(pr.get("body"))
    if issue_number:
        issue = gh_json(f"/repos/{REPO}/issues/{issue_number}")
        if issue and issue.get("state") == "open":
            issue_labels = {l.get("name") for l in (issue.get("labels") or [])}
            if "ai-ready" in issue_labels:
                state["issue_number"] = issue_number
            else:
                return bail(state, args, f"originating issue #{issue_number} has no ai-ready label")

    # --- Decide action from the triggering CI run -------------------------
    conclusion = state.get("ci_conclusion")
    if conclusion == "success":
        state["action"] = "review"
    elif conclusion in ("failure", "timed_out", "action_required", "startup_failure"):
        state["action"] = "ci-fix"
        if run:
            jobs = gh_json(f"/repos/{REPO}/actions/runs/{args.run_id}/jobs")
            state["failed_jobs"] = [
                {"name": j.get("name"), "conclusion": j.get("conclusion")}
                for j in (jobs or [])
                if j.get("conclusion") not in ("success", "skipped", None)
            ]
    else:
        return bail(state, args, f"CI conclusion is '{conclusion}'; nothing to do")

    # Skip if this exact head sha was already reviewed (no duplicate reviews).
    if state["action"] == "review":
        last = last_review_comment(pr["number"])
        if last and last.get("reviewed_sha") == pr["head"]["sha"]:
            state["action"] = "skip"
            state["reason"] = f"head sha {pr['head']['sha']} already reviewed"
            save_state(state, args.out)
            print(json.dumps(state))
            return 0

    save_state(state, args.out)
    print(json.dumps(state))
    return 0


def last_review_comment(pr_number):
    """Find the most recent AI review comment; return parsed JSON payload."""
    out = gh(
        "-X", "GET",
        f"/repos/{REPO}/issues/{pr_number}/comments?per_page=100&sort=created&direction=desc",
        check=False,
    )
    if out.returncode != 0:
        return None
    for c in json.loads(out.stdout or "[]"):
        body = c.get("body", "")
        if REVIEW_MARKER in body:
            try:
                start = body.index("{")
                end = body.rindex("}")
                payload = json.loads(body[start : end + 1])
                return payload
            except (ValueError, json.JSONDecodeError):
                continue
    return None


# ---------------------------------------------------------------------------
# parse (validate the reviewer output — FAIL CLOSED)
# ---------------------------------------------------------------------------


def parse_json_object(text):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


def validate_review(review):
    """Returns list of problems; empty list == valid."""
    problems = []
    if not isinstance(review, dict):
        return ["review output is not a JSON object"]
    if review.get("verdict") not in ("approve", "changes_requested"):
        problems.append(f"verdict must be 'approve' or 'changes_requested', got {review.get('verdict')!r}")
    for key in ("blocking_findings", "minor_findings"):
        if not isinstance(review.get(key), list):
            problems.append(f"{key} must be an array")
    if not isinstance(review.get("summary"), str) or not review["summary"].strip():
        problems.append("summary must be a non-empty string")
    for i, f in enumerate(review.get("blocking_findings", [])):
        if not isinstance(f, dict):
            problems.append(f"blocking_findings[{i}] is not an object")
            continue
        for field in ("file", "problem", "suggested_fix"):
            if not isinstance(f.get(field), str) or not f[field].strip():
                problems.append(f"blocking_findings[{i}].{field} must be a non-empty string")
    return problems


def cmd_parse(args):
    state = load_state(args.state)
    raw = open(args.raw, encoding="utf-8", errors="replace").read()
    review = parse_json_object(raw)
    problems = validate_review(review) if review else ["no JSON object found in reviewer output"]
    if problems:
        print("REVIEW OUTPUT INVALID (fail closed):")
        for p in problems:
            print(f"  - {p}")
        with open(args.out, "w") as f:
            json.dump({"valid": False, "problems": problems}, f, indent=2)
        return 1
    review["reviewed_sha"] = state["head_sha"]
    review["pr_number"] = state["pr_number"]
    review["reviewed_at"] = timestamp()
    with open(args.out, "w") as f:
        json.dump(review, f, indent=2)
    print(f"review valid: verdict={review['verdict']} blocking={len(review['blocking_findings'])}")
    return 0


# ---------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------


def cmd_publish(args):
    state = load_state(args.state)
    pr_number = state["pr_number"]
    rounds = count_fix_rounds_simple(pr_number)

    if args.review:
        review = json.load(open(args.review))
        if not review.get("valid", True):
            print("refusing to publish invalid review (fail closed)")
            return 1
        verdict = review["verdict"]
        summary = review.get("summary", "")
        payload = json.dumps(review)
        body = (
            f"## 🤖 AI Review ({verdict})\n\n{summary}\n\n"
            f"<details><summary>Structured review</summary>\n\n```json\n{payload}\n```\n\n"
            f"</details>\n\n{REVIEW_MARKER}\n\n"
            f"_reviewed_sha: `{review['reviewed_sha']}`_\n"
        )
        if verdict == "approve":
            body += "\nThe deterministic merge gate will decide whether this PR may be merged."
            add_labels(pr_number, "ai-approved")
            remove_label(pr_number, "ai-reviewing")
        else:  # changes_requested
            body += "\nBlocking findings have been reported. The fix loop will address them."
            if rounds < MAX_FIX_ROUNDS:
                add_labels(pr_number, "ai-fix-needed")
            else:
                add_labels(pr_number, "ai-needs-human")
            remove_label(pr_number, "ai-reviewing")
        remove_label(pr_number, "ai-fix-needed")
        comment(pr_number, body)
        print(f"published review verdict={verdict} rounds={rounds}")
        return 0

    if args.ci_fix:
        info = json.load(open(args.ci_fix))
        failed = info.get("failed_jobs", [])
        failed_text = "\n".join(f"- {j.get('name')}: {j.get('conclusion')}" for j in failed) or "- (see run logs)"
        body = (
            f"## 🚦 AI CI Failure\n\nCI failed for head sha `{state['head_sha']}`.\n\n"
            f"{failed_text}\n\nRun: {info.get('run_url', '(unknown)')}\n\n{CI_FAILURE_MARKER}\n"
        )
        if rounds < MAX_FIX_ROUNDS:
            add_labels(pr_number, "ai-fix-needed")
            body += "\nThe fix loop will address the CI failures."
        else:
            add_labels(pr_number, "ai-needs-human")
            body += "\nFix rounds exhausted — a human must resolve this."
        remove_label(pr_number, "ai-reviewing")
        comment(pr_number, body)
        print(f"published ci-fix request rounds={rounds}")
        return 0

    print("nothing to publish")
    return 0


# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("resolve")
    r.add_argument("--run-id")
    r.add_argument("--head-sha", required=True)
    r.add_argument("--pr-number", type=int)
    r.add_argument("--out", default="state.json")

    pa = sub.add_parser("parse")
    pa.add_argument("--raw", required=True)
    pa.add_argument("--state", required=True)
    pa.add_argument("--out", default="review.json")

    pu = sub.add_parser("publish")
    pu.add_argument("--state", required=True)
    pu.add_argument("--review")
    pu.add_argument("--ci-fix")

    args = parser.parse_args()
    if args.cmd == "resolve":
        return cmd_resolve(args)
    if args.cmd == "parse":
        return cmd_parse(args)
    if args.cmd == "publish":
        return cmd_publish(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
