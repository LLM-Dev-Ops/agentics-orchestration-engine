# ADR-0001: Real Core Clients and Withdrawal from the plan_approved Trigger

**Status:** Proposed
**Date:** 2026-07-27

> See **ADR-011: Layer-4 Execution Spine Reconnection** in `agentics-enforcement`
> (`plans/adr/ADR-011-layer-4-execution-spine-reconnection.md`) for the platform-wide
> decision this ADR implements. This document covers only this repository's actions.

---

## Context

Two problems: this service never calls the real Layer-3 cores, and it participates in the
`plan_approved` event in two contradictory roles at once.

### The production server hardwires mock cores

`src/server.ts:603-612`, inside the `/v1/simulate` handler:

```ts
const ruvectorClient = createRuvectorClientFromEnv();
const coreClients = createMockCoreClientRegistry();
const engine = createOrchestrationEngine();
engine.initialize(ruvectorClient, coreClients);
```

The Ruvector client is built from environment configuration, but the core registry at
`src/server.ts:610` is **unconditionally mock** — imported at `src/server.ts:20` from
`./integration/cores/mock-cores.js` and defined at
`src/integration/cores/mock-cores.ts:417`. There is no env-gated alternative, no feature
flag, and no real registry constructor in the server path.

The same mock is the fallback in the listener: `src/ruvector/execution-listener.ts:143` —
`this.coreClients = coreClients ?? createMockCoreClientRegistry()`.

So the real Security / Data / Governance / Automation cores are **never invoked in
production**. Worse, the endpoint still treats the outcome as genuine: it builds a result
packet (`src/server.ts:631-638`), validates it against the contract schema
(`:641-646`), and writes it to `RESULTS_INDEX_URL` (`:649-656`), failing loudly if that write
fails (`:658-662`). The result is a contract-valid, permanently recorded run in which no core
did any work. This defeats the assignment map of `agentics-enforcement` ADR-006, which can
only be enforced if cores are actually called.

### This service both publishes and subscribes to `plan_approved`

**Publishes.** `handleCreateRun` at `src/server.ts:708-771` mints its own `runId`
(`:727` — `run-${Date.now()}-${Math.random()...}`) and publishes
`{ type: 'plan_approved', runId, source: 'orchestration', timestamp, payload }`
(`:737-743`) to `${RUVECTOR_SERVICE_URL}/events/decisions` (`:745-753`).

**Subscribes.** `src/ruvector/client.ts:420-421` sets `url.searchParams.set('types', 'plan_approved')`,
consumed by `src/ruvector/execution-listener.ts:230`, deployed as a separate listener service
(`README.md:93`, `src/ruvector/startup.ts:182`).

A service that publishes and subscribes to the same event is a self-trigger loop.

Self-minting `runId` and self-declaring a plan approved also conflicts with
`agentics-enforcement` ADR-004, which makes ruvector-service the **sole** authority for
accepting execution and minting identity. This repo's own `/v1/simulate` handler already
honours that rule — `src/server.ts:614` is explicitly commented "NO execution_id minted here",
and it uses the Ruvector-minted ID at `:668`. `handleCreateRun` contradicts its sibling
handler in the same file.

**Duplicate subscriber.** `agentics-execution-engine/src/execution_listener.ts:24` also
subscribes to `plan_approved`, with no documented arbitration. That subscription is currently
dead — `agentics-execution-engine/src/ruvector_client.ts:39-52` discards the handler — but once
repaired, both engines would dispatch every approved plan.

**Incompatible shapes.** The envelope published at `src/server.ts:737-743` does not satisfy
this repo's own `PlanApprovedEvent` (`src/ruvector/types.ts:104-116`, guard at `:265-269`),
which requires `simulation_id`, `plan_id` and `execution_profile`. This service publishes
events its own listener would reject.

## Decision

Two changes, both narrowing this service's scope.

**1. Real core clients, fail closed.** `createMockCoreClientRegistry()` is removed from every
server-reachable path. The registry is constructed from environment configuration
(`SECURITY_CORE_URL`, `DATA_CORE_URL`, `GOVERNANCE_CORE_URL`, `AUTOMATION_CORE_URL`); if any
is absent the service **fails at startup** rather than silently substituting a mock
(ADR-011 Decision 4). `mock-cores.ts` remains exported for tests only.

**2. This service exits the `plan_approved` event entirely.**
Per ADR-011 Decision 5, **`agentics-execution-engine` is the sole subscriber**, and
**ruvector-service is the sole publisher**. This repo does neither.

`agentics-orchestration-engine` becomes a **synchronous delegation service**: `POST /v1/simulate`
in, real core calls out, result packet to the results index. That role needs no event
subscription. `handleCreateRun` is rewritten to submit the intent to Ruvector's accept/decision
endpoint and let Ruvector decide — restoring ADR-004 — instead of publishing its own approval.

## Consequences

### Easier

- Runs recorded in the results index reflect real core work, so the ADR-006 assignment map becomes verifiable.
- Removing the self-publish/self-subscribe loop eliminates a whole class of confusing behaviour, including publishing events this repo's own type guard rejects.
- Sole-subscriber ownership in the execution-engine removes the double-dispatch race that would otherwise appear the moment that engine's subscription is repaired.
- This service's responsibility becomes a single sentence, and the two contradictory identity policies in `src/server.ts` (`:614` vs `:727`) collapse into one.

### Harder

- **Latency and failure rate rise.** Mock cores returned instantly and never failed. Real cores add network hops, timeouts and partial failures, and `/v1/simulate` already awaits the results-index write without fire-and-forget (`src/server.ts:648-656`), so the whole request gets slower.
- **This is an infrastructure change, not only code.** The listener service in `README.md:93` must be undeployed, and its docs (`README.md:35`, `:53`, `:64`) corrected.
- Fail-closed startup means any environment missing a core URL stops booting; every deployment target must be audited first.
- Callers of `POST /api/v1/runs` currently receive a locally-minted `runId` in the `202` response (`src/server.ts:769-770`). They will receive a Ruvector-minted `execution_id` instead — a breaking response-contract change.
- Coordinated release required: this repo must stop publishing the ad-hoc envelope in the same window the execution-engine starts consuming the canonical one.

## Implementation Plan

### Real cores

1. Replace `createMockCoreClientRegistry()` at `src/server.ts:610` with a real registry built from `SECURITY_CORE_URL`, `DATA_CORE_URL`, `GOVERNANCE_CORE_URL` and `AUTOMATION_CORE_URL`, mirroring how `createRuvectorClientFromEnv()` is used at `:609`.
2. Remove the mock import at `src/server.ts:20`.
3. Apply the same change to the `??` fallback at `src/ruvector/execution-listener.ts:143` (or delete the file per step 7).
4. Add a startup check that all four core URLs are configured; fail closed with an explicit error naming the missing variable.
5. Keep `createMockCoreClientRegistry` exported from `src/index.ts:116` for tests, and add a CI check that no file under `src/` outside tests imports `integration/cores/mock-cores.js`.

### Exit the plan_approved event

6. Rewrite `handleCreateRun` (`src/server.ts:708-771`): delete the self-minted `runId` (`:727`) and the synthetic `plan_approved` publish (`:737-753`). Submit the intent to Ruvector's accept/decision endpoint and return the Ruvector-minted `execution_id`. Update the `RunCreateResponse` type and the doc comment at `:702-707`, which currently states the handler "publishes a plan_approved decision to Ruvector so the execution engine listener picks it up".
7. Delete the `plan_approved` filter at `src/ruvector/client.ts:420-421`. Retire `src/ruvector/execution-listener.ts` and the listener bootstrap in `src/ruvector/startup.ts` (see `:84`, `:182`).
8. Move `PlanApprovedEvent` and its type guards (`src/ruvector/types.ts:104-116`, `:254-269`) to `agentics-contracts` as `events/v1/plan-approved.schema.json` (ADR-011 Decision 6) — this repo's definition is the most complete of the three and becomes the canonical basis. Remove the local copy once the contract package ships.
9. Remove the listener service from deployment configuration.
10. Correct `README.md:35`, `:53`, `:64` and `:93` to describe a synchronous delegation service with no event listening.
11. Update `test/unit/ruvector/execution-listener.test.ts` (`:101`, `:257`) — delete alongside the retired listener.

## Verification

1. **No mocks in the server path.** `grep -rn "createMockCoreClientRegistry" src/` returns hits only in `src/integration/cores/mock-cores.ts` and `src/index.ts`. A CI check (per `agentics-enforcement` ADR-010) fails the build if `src/server.ts` imports from `integration/cores/mock-cores.js`.
2. **Fail closed.** Start the service with `SECURITY_CORE_URL` unset; assert startup fails with an error naming that variable. It currently starts successfully and serves traffic against mocks.
3. **Real cores are called.** Integration test: `POST /v1/simulate` against stub core servers; assert each expected core received a request and that the result packet written to `RESULTS_INDEX_URL` reflects the stub responses.
4. **No plan_approved participation.** `grep -rn "plan_approved" src/` returns nothing. Repo-wide, subscription appears only in `agentics-execution-engine` and publication only from ruvector-service.
5. **No self-minted identity.** `grep -n "run-\${Date.now()}" src/server.ts` returns nothing; `POST /api/v1/runs` returns a Ruvector-minted `execution_id`, satisfying `agentics-enforcement` ADR-004.
6. **Listener retired.** `src/ruvector/execution-listener.ts` and `src/ruvector/startup.ts` no longer exist or no longer subscribe; the listener service is absent from deployment config; `README.md` no longer advertises it.
7. **No double dispatch.** End-to-end: one approved plan yields exactly one execution graph, produced by `agentics-execution-engine`.
8. **Assignment map honoured.** With real cores wired, assert each core only calls repos in its `assignedRepos` list per `agentics-enforcement` ADR-006 — unverifiable while the registry is mock.
