---
name: grilling
description: "Grill the user relentlessly about a plan, decision, or idea until you share an understanding. User-invoked only: hidden from the model, run with /skill:grilling."
disable-model-invocation: true
metadata:
  opencode/autoinvoke: false
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask that frontier with one `ask_user_question` call, then wait for the tool result before the next round. The tool call is the round — do not also paste it as chat text, and do not stack calls. If `ask_user_question` is not available, stop and say so; do not fall back to a prose questionnaire.

Each question is one decision:

- `question` ends with `?`. The body can be several paragraphs; put the context there.
- `header` is a chip of 16 characters or fewer.
- 2–4 `options`. Each has a short `label` (1–5 words, 60 characters or fewer) and a `description` of what the choice means or costs.
- Put your recommended answer first and append `(Recommended)` to its label. The rationale belongs in that option's description.
- Set `multiSelect: true` only when several options can all be right.
- Use `preview` when the choice is a concrete artifact (mockup, snippet, diagram, config). Previews are single-select only.
- Never author an option labelled `Other`, `Type something.`, or `Next`. The dialog already appends a custom-answer row; that is how an answer that fits none of the options gets in.

One call holds at most 4 questions. If the frontier is larger, ask the 4 that unblock the most of the tree, wait, then ask the rest. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. Read the tool result, including custom answers, per-question notes, and a global note. If the user declines, stop. Do not re-ask the same questions in prose.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them through `ask_user_question` and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Confirm that with one last `ask_user_question` before acting. Do not act until the user confirms you have reached a shared understanding.
