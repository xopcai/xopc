# Manual understanding refresh

The user-understanding dialog offers **Update understanding** on each authorized source and **Update all** in its header. A click starts work immediately. Closing the dialog does not cancel it. Automatic source collection remains independent; manual requests explicitly rerun analysis even when source content is unchanged.

## Product behavior

- Show queued, reading, waiting for desktop collection, analyzing, and terminal states per source.
- Persist progress on the gateway; reload the page to recover it. A gateway restart preserves linked folder/connector progress. Interrupted desktop analysis becomes a visible failure with Retry.
- Repeated clicks reuse an active manual run for the same source. A completed run can be started again.
- A failed source does not erase successful results from other sources. Retry operates on the selected source.
- Reuse existing reconciliation rules for user corrections and deletion suppression. Refresh does not clear memory first or automatically expand source authorization.
- Desktop collection needs an open desktop app. Waiting expires after two minutes; analysis receives a three-minute abort signal. No raw desktop input is stored in the refresh batch.
- Only show counts supplied by an executor. A successful analysis can produce no new understanding.

## Implementation

`UnderstandingRefreshService` coordinates existing source executors. Source runs hold progress and executor IDs; migration 185 adds only batch membership. No second generic job queue or alternative memory model is introduced.

- Work folders: call the existing explicit rescan operation.
- Connectors: enqueue the existing learning operation with a manual idempotency key; use its bounded source retrieval and semantic analysis.
- Desktop sources: request collection through the existing Electron bridge, then call the existing source analysis/persistence pipeline. Collect one desktop source at a time.

The client coordinator is mounted in the app shell. It polls every 1.5 seconds during work and every 30 seconds while idle, and refreshes on focus. Completed work invalidates the user-model query.

Authenticated API:

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/user-model/refresh` | Start all sources with `{}`, or selected grant IDs with `{sourceIds}` |
| GET | `/api/user-model/refresh` | Latest batch and latest manual run for each active source |
| GET | `/api/user-model/refresh/:id` | Batch progress and aggregate outcome |
| POST | `/api/user-model/refresh/sources/:runId/collection` | Submit bounded desktop items or a collection error |

The dedicated lazy route bundle precedes the broader user-model bundle. The obsolete `/api/context-sources/grants/:grantId/refresh` handler has been removed; no compatibility branch is retained.

## Review and validation

1. Scheduling: duplicate requests, unchanged-item reanalysis, partial batches, executor start failure, and restart recovery.
2. Integration: authenticated HTTP through real lazy routing; desktop recovery/submission; modal regression tests.
3. Authorization and persistence: foreign-source input rejected; revoked sources cannot be reactivated by refresh; authorization changes during analysis prevent persistence; local execution preserves the existing processing policy. Derived desktop writes share a SQLite transaction.

Live external account permissions and native OS collection remain environment-dependent and are not exercised by automated tests.
