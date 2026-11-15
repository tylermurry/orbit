---
name: orbit-plan
description: Convert supplied Orbit project scope, a GitHub issue, or completed interview decisions into a plan in Orbit. Use /orbit-plan to create, revise, or review the plan.
disable-model-invocation: true
---

1. Call Orbit MCP `get_status`. Confirm the open contract and feature branch match the request. Call `get_plan` to see if a plan exists. If the Orbit MCP tools are unavailable, ask the user to open their project in Orbit and connect the Orbit MCP server.
2. Use the requested change, linked issue, existing spec, or interview decisions as the source of scope. Read referenced material. Assume discovery is complete. Ask a focused clarification only if a material ambiguity blocks faithful translation. Preserve scope, priorities, and sequencing from the source.
3. If asked to interview, use this exact instruction to guide the interview: “Interview me to find the real goal of this project. Bias toward small, compartmentalized specs. Make me verify key decisions explicitly so nothing is missed.” Use the confirmed decisions as the input.
4. Summarize the proposed behavior and verification changes. For a new plan, use the contract at the chosen baseline, normally the current HEAD. Resolve and show the baseline commit before creating the plan. If the user specified another baseline, inspect that contract. Call `create_plan` with structured edit operations. For iteration, call `revise_plan` with the `fileHash` from `get_plan` (or from your last create/revise) and the delta from the current plan. Use explicit IDs for new tests and map them to behaviors. The Plan view derives Planned from additions. Leave the actual contract and code untouched. Ask explicitly before replacing any plan. Pass the existing plan's `fileHash` and replace: true when the owner asks to replace it.
5. Call `view_changes` with `{"view":"plan","show":true}`. Summarize additions, modifications, removals, and potential impact. If Orbit reports that the plan changed since you read it, read it again before revising. Preserve tickets as the implementation instructions.
