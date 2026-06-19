# KodaX Capability Ledger

Last reviewed: 2026-06-18

This file is the Space-side source of truth for capabilities that depend on the upstream KodaX SDK. It exists to keep desktop feature planning honest: a feature is either supported by the current SDK contract, partially implemented through an available event/API, planned on the Space side, or blocked until KodaX exposes a contract.

## Version Baseline

| Component | Current baseline | Notes |
| --- | --- | --- |
| KodaX Space app | 0.1.19 | 0.1.20 work is implementation-in-progress, not released. |
| Desktop package | 0.1.19 | `@kodax-space/desktop`. |
| IPC schema package | 0.1.19 | Aligned from stale 0.1.9 during F081. |
| UI kit package | 0.1.19 | Aligned from stale 0.1.9 during F081. |
| KodaX SDK | 0.7.52 installed, `^0.7.52` root and desktop specs | Keep this row aligned with `package.json`, `apps/desktop/package.json`, and `package-lock.json`. |

## Capability Contract

Runtime IPC contract: `space-v0.1.20`

`space.version` now exposes:

| Field | Purpose |
| --- | --- |
| `kodaxSdkVersion` | The installed `@kodax-ai/kodax` package version resolved by the Electron main process. |
| `kodaxDependencySpec` | The dependency range Space was installed/launched with. |
| `capabilityContract` | Space's own interpretation contract for SDK-backed desktop features. |
| `capabilities[]` | Per-feature support ledger consumed by diagnostics UI and later by status panels. |

## Current Ledger

| Capability | Status | Evidence / next action |
| --- | --- | --- |
| `repointel.trace` | supported | KodaX SDK session trace events are mapped into `repointel_trace` session events and shown by the chip and `/repointel trace`. |
| `repointel.status` | supported | Space exposes local status/doctor/readout for project, git root, trace source, and warm support. Standalone warm remains SDK-gated. |
| `quickAsk.tempSession` | supported | Quick Ask uses a temporary plan-mode session, captures events locally, cleans up on close, and can promote the persisted session into Coder. |
| `quickAsk.sideQuery` | blocked | Current SDK does not expose a true side-query API. Do not claim isolated side-query behavior until KodaX ships it. |
| `handoff.receive` | supported | Space reads, watches, accepts, and dismisses `~/.kodax/handoffs/*.json` files; CLI-side emit remains a separate SDK/CLI integration gate. |

## Review Rules

- Do not mark an SDK-backed capability as `supported` unless there is a stable API/event path in the current SDK.
- If a feature is simulated through existing sessions or local files, mark it `partial` unless the UX and cleanup guarantees match the intended contract.
- If the missing piece is upstream SDK surface, mark it `blocked` and link the later KodaX-side requirement from the feature design.
- Update this file and `space.version` together when capability status changes.
