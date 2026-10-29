# Discovery deployment and operations

Canonical checkout: `/Users/noah/code/esemplastify`. Keep repositories out of iCloud-controlled directories.

## Live service

- Worker: `esemplastify`
- Public health: <https://esemplastify.gr4gwzrfq2.workers.dev/health>
- Editorial API: same origin, `/api/*`, bearer authentication required
- D1: `esemplastify-ledger`, real binding ID in `wrangler.jsonc`
- R2: `esemplastify-evidence`, private; `r2.dev` public access verified disabled
- Queue: `esemplastify-ingestion`, one-message batches, concurrency one, four retries
- Dead-letter queue: `esemplastify-ingestion-dlq`
- Cron: `*/30 * * * *`, with daily draft selection at 06:00 America/Los_Angeles inside the Worker

Deployed October 29, 2026 from merged milestone commit `1034a98f8ed0a4288de7aea734a169f8e7cc7892`, with the dedicated D1 binding added. The initial upload version was `97269ef8-e343-4e8b-b0c5-96e9a628de1b`; installing the editorial secret created active version `3e09a848-bab8-4597-b26a-99c22c2095ed`. No runtime source changes were needed to make ingestion work in Cloudflare. This rollout PR records the binding, helper, and operational evidence; it is not a merge or automatic-deployment instruction.

## Verified remotely

- Public `/health`: HTTP 200.
- Unauthenticated `/api/lineup`: HTTP 401 after secret installation.
- Authenticated ingestion: HTTP 202, 11 sources queued.
- All 11 retained sources completed a fetch successfully, with no source error recorded in the first completed pass.
- Independent remote D1 query: 11 sources, 215 stories, 215 articles, 215 evidence records, 11 fetch records, **zero confirmed coverage records**.
- Authenticated lineup: nine items, 45 estimated minutes.
- A selected story's provenance was retrieved through the API; its private R2 snapshot was downloaded by an authorized operator and its SHA-256 matched the content-addressed snapshot key.
- Today's October 29 draft was saved manually after ingestion: one immutable episode draft, nine items, 45 estimated minutes. It is not evidence of a scheduled 06:00 execution.
- A bounded live tail captured successful queue invocations with `outcome: ok` and no exceptions in that sample.
- Queue producer/consumer binding and retry/dead-letter configuration were verified. No real failed-source retry was induced; retry timing is covered by the deterministic test suite.

Bucket object-count summaries may lag actual writes; direct object retrieval and hash verification establish retained provenance. No attempt was made to infer a missing object from a lagging summary counter.

## Credential-safe operator access

A fresh random editorial credential was installed using Wrangler stdin. Its operator copy is in the local macOS Keychain under service `esemplastify.editorial`, account `production`. Its value was never printed, placed in command arguments, written to a repository file, or committed. Only the `ADMIN_TOKEN` secret binding name/type was listed for verification.

The local helper reads Keychain in memory and pins requests to this deployed origin. It requires macOS, Python 3, Node 24, and access to that Keychain item:

```sh
cd /Users/noah/code/esemplastify
node scripts/editorial-request.mjs /api/sources
node scripts/editorial-request.mjs /api/lineup
node scripts/editorial-request.mjs /api/episodes/2026-10-29
node scripts/editorial-request.mjs /api/followups
```

The helper never prints the bearer credential and will fail if Keychain access is unavailable. It permits GET and POST; POST calls can mutate editorial data. An explicit authorized ingestion poll is:

```sh
node scripts/editorial-request.mjs /api/ingest POST
```

Do not confirm coverage merely to test follow-up behavior. A planned draft is not a published episode. Keep raw runtime captures and feed data under ignored `work/`; do not commit them.

## Remaining observation

A read-only chat follow-up is scheduled for 06:10 Pacific on October 30, October 31, and November 1, 2026. It checks source freshness and the automatically saved daily draft, including the November 1 daylight-saving transition, then pauses itself. It reports meaningful results or failures and otherwise stays quiet. This observer depends on the local Codex app and Keychain being available; the Cloudflare ingestion and draft schedule run independently.

The first actual scheduled 06:00 draft is still unobserved at deployment time. A genuine elapsed 24–48-hour verification-follow-up cycle is also unverified: no initial episode has been published or marked covered. The observer must report that gap without fabricating coverage or verification. Deterministic tests cover eligibility and expiry, but do not substitute for an actual elapsed production cycle.

No speech generation, audio assembly, podcast publication, paid model integration, or external distribution is active. A later audio pipeline needs an earlier cutoff to deliver finished audio at 06:00.
