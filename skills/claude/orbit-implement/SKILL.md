---
name: orbit-implement
description: Turn the current Orbit plan into an approved, technically detailed implementation plan, then build it. Use /orbit-implement after /orbit-plan; it offers /orbit-sync when the work is done.
disable-model-invocation: true
---

1. Call Orbit MCP `get_status` and `get_plan`. Confirm the open contract and feature branch match the plan and that the plan applies to this branch. If there is no applicable plan, stop and tell the user to run /orbit-plan first. If the working tree has unsaved Orbit edits, resolve them with the owner before continuing. If the Orbit MCP tools are unavailable, ask the user to open their project in Orbit and connect the Orbit MCP server.
2. Read the whole plan as the specification. Call `view_changes` with `{"view":"plan"}` and read every change at the pinned baseline: product capabilities, system capabilities, relationships, flows, behaviors, and planned tests. Use `get_entity`, `list_flows` and `get_flow` for detail. Treat flows as the intended order of calls between the product and its systems.
3. Explore the codebase to find where each change lands: the modules, files, data models, interfaces and existing tests involved. Reuse what exists. Note anything in the plan that conflicts with the code, is ambiguous, or looks infeasible, and raise it with the user rather than silently working around it.
4. Enter plan mode (use `/plan`, or the EnterPlanMode tool) and write the implementation plan. Its top-level goal is: create a solution that fully implements the proposed plan in Orbit. Do not restate the Orbit plan; add the technical detail the Orbit plan deliberately leaves out:
   - for each added, modified, or removed product capability and system capability: the concrete files, modules, functions, types, data and migrations to create or change, and what gets deleted;
   - for each relationship: the call, import, or dependency that realises it;
   - for each flow: how the real code path follows the steps, in order, including the replies;
   - for each behavior: the test that verifies it, using the planned test IDs and locations from the Orbit plan, and how it will be run;
   - the order of work, dependencies between steps, risks, open questions, and the commands that prove it works (build, tests, validation).
   Every item in the Orbit plan must map to something in the implementation plan, and nothing outside the Orbit plan should be added. Present it for approval and wait. Revise it until the user approves.
5. Once approved, get to work and implement everything. Write the real tests under the planned IDs and locations, run them, and fix failures. Do not edit the Orbit contract or `orbit.plan.json`; reconciling the contract is /orbit-sync's job. Commit or push only if the user asked. If you must deviate from the approved plan, say so and ask first when the deviation is material.
6. Finish by reporting what was built, what was verified (with the real test results), and anything left undone or unverified. Then ask the user whether they would like to run /orbit-sync to reconcile the contract with the working tree. Do not run it unless they say yes.
