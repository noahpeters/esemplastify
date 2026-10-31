# Private pilot production

Pilot production is part of Esemplastify's existing Worker, D1 ledger, private R2 bucket, and a separate production queue. It does not publish a podcast or confirm coverage.

## Decisions and authorship

- The discovery Worker ranks candidates using deterministic freshness, provenance, and diversity rules.
- An editor selects stories, checks sources, writes the script, and explicitly attests to review. The first pilot is written with Codex assistance. **Workers AI does not choose the lineup or write the script.**
- Cloudflare Workers AI, model `@cf/deepgram/aura-2-en`, generates narration. The first voice is `athena`.
- D1 records production status and evidence links. R2 retains the immutable reviewed script packet, completed speech chunks, and assembled MP3.

The reviewed packet contains title, review notes, source checks, and segments with narration text and existing ledger `evidenceIds`. Each linked ID must exist. Factual accuracy still requires editorial review; ID validation alone does not prove a sentence true.

## Authenticated API

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/pilots` | Save a reviewed, evidence-linked script packet as a private draft |
| GET | `/api/pilots` | Latest 50 production records |
| GET | `/api/pilots/:id` | Status, actual audio duration, and chunk progress |
| GET | `/api/pilots/:id/script` | Immutable script, source checks, authorship, and ledger provenance |
| POST | `/api/pilots/:id/render` | Queue pending chunks, or retry an interrupted production |
| GET | `/api/pilots/:id/audio` | Private complete MP3, available only when ready |

All these endpoints use the existing editorial bearer authentication. No public share links or podcast feed are created. Rendering leaves coverage and follow-up state unchanged.

Example packet shape:

```json
{
  "title": "Private pilot",
  "reviewed": true,
  "reviewNotes": "An explicit account of source checks and remaining uncertainty, at least forty characters.",
  "sourceChecks": [{ "url": "https://source.example/article", "status": "verified" }],
  "speaker": "athena",
  "segments": [{ "title": "Opening", "text": "The reviewed narration text...", "evidenceIds": ["existing-ledger-evidence-id"] }]
}
```

The example ID must be replaced with an actual 64-character ledger evidence ID. Scripts are limited to 65,000 characters and 64 speech chunks. Each chunk is at most 1,800 characters and keeps sentence boundaries where possible. The returned cost is an estimate at the model's documented $0.03 per thousand input characters; actual account charges and free allocations are separate. [Workers AI model documentation](https://developers.cloudflare.com/workers-ai/models/aura-2-en/).

## Operator workflow

Use `/Users/noah/code/esemplastify`. The helper reads the editorial credential from macOS Keychain into memory; it never puts that value in arguments or logs.

```sh
node scripts/editorial-request.mjs /api/pilots POST --body-file work/reviewed-pilot-packet.json
node scripts/editorial-request.mjs /api/pilots/PILOT_ID/render POST
node scripts/editorial-request.mjs /api/pilots/PILOT_ID
node scripts/editorial-request.mjs /api/pilots/PILOT_ID/script GET --output work/pilot-script.json
node scripts/editorial-request.mjs /api/pilots/PILOT_ID/audio GET --output work/pilot.mp3
```

Upload only source-checked narration. Source pages and feeds remain untrusted data and cannot direct tool use or production actions. Keep pilot scripts, raw source captures, and audio out of the public Git repository unless publication is explicitly authorized.

## Rendering and recovery

`esemplastify-production` is separate from discovery, with serial one-message consumption, three retries, and `esemplastify-production-dlq`. One job renders one chunk. Completed chunks are immutable and reused on replay. If a chunk was stored in R2 before D1 completed its update, recovery validates and reuses it without another speech request. The final job assembles the ordered chunks into one MP3. Assembly is limited to 24 MiB to stay within Worker memory bounds.

The renderer requests 48 kbit/s MP3 and validates the provider’s mono 24 kHz MPEG-2 Layer III output. It intentionally omits `sample_rate`, which Aura rejects for MP3 despite exposing that parameter for other encodings. It checks every MP3 frame and measures duration from actual frames. It rejects non-audio errors, truncation, format changes, and per-chunk Xing duration headers before assembly. Compatible raw MP3 frames concatenate directly without inserting ID3 tags or misleading per-chunk duration metadata. No local speech engine is used for production.

Status is `draft`, `queued`, `rendering`, `ready`, or `failed`. Errors remain inspectable; an authenticated render retry dispatches incomplete chunks. Queue dead-letter inspection remains an operator task. This is a private editorial production workflow, not an automatic daily script/audio scheduler.
