# Editorial policy: informative daily briefing

The purpose is to keep the listener informed about what is happening, including important smaller developments. AI is a production tool. Stories stand independently; an overarching theme, entertainment arc, or clever connection is not required.

## Selection and timing

- Prefer timely reporting with public significance, practical consequences, accountability, useful new knowledge, or human and cultural relevance. Major national headlines and small local developments can both earn a place.
- Subject and regional labels describe the lineup; neither earns a ranking bonus or has a minimum or maximum quota. Several consequential stories about the same subject may be selected.
- Retain a broad discovery pool. Add NPR National and Business, BBC US/Canada, The Guardian US, and Seattle Times local reporting to the earlier 22 feeds. These are leads, not an exhaustive local-news network. Shared publishers count together.
- The deterministic ranker exposes freshness, capped headline cues for public interest, publisher support, a small primary-evidence bonus, a recurring-feature penalty, and publisher concentration. Its cues are provisional triage, not semantic understanding, proof of importance, or fact verification. Publication freshness describes the report, not necessarily the date of the underlying event.
- Known publication age controls initial eligibility (72 hours). Use the earliest retained publication in a cluster so a reprint cannot rejuvenate old news. Unknown publication dates retain observation time with a lower freshness score and an explicit review flag; routine undated material is not selected.
- Keep publisher concentration modest: every contributing publisher is charged the story's full estimated time, with a ceiling of 25% of requested runtime (at least four minutes). A small time-based penalty helps otherwise comparable reporting from other publishers. There is no source-count threshold: a consequential local report can be included as a brief while verification is pending.
- AI has no selection bonus and remains limited to one story per lineup. There is no obligation to include any AI coverage.

## Segment depth

The current planner proposes **one-minute briefs, two-minute reports, and four-minute explainers**. A brief is the default. A higher-scoring story with substantive source summaries can receive two minutes; a four-minute explainer also requires at least two publishers and more source material. Repeated versions of the same article do not increase the material budget. An approved follow-up receives a focused two-minute report.

These are editorial ceilings at an estimated 150 words per minute, not measured audio or a demand to fill time. They may be shortened during script review. Longer text or multiple publishers do not prove reporting quality, independence, or accuracy. The planner cannot create detail missing from the reporting. It keeps a 48-item safety bound and never stretches a story or downgrades an evidence-supported explainer to a brief merely to fill a final gap. If there is not enough material for 30 minutes, report the shortfall. A 30–60-minute daily episode remains the target, not a reason for padding.

## Verification and narration

Each proposed item exposes reasons, estimated depth, word budget, source provenance, and review flags. The lineup and authenticated `/api/editorial-policy` expose the shared script guidance. New immutable pilot packets record its version and guidance; historical scripts and episode snapshots remain intact.

Explain what happened, when and where, why it matters, useful specifics, and what remains uncertain. Use straightforward transitions. Trace social posts to dated original reporting or primary evidence; screenshots and engagement counts are discovery leads, not corroboration. Do not import the example screenshots as verified facts. Distinguish allegations, confirmed facts, interpretation, preliminary research, and disagreement. Do not imply separate incidents are connected without evidence.

The ranker proposes; an editor checks the actual sources and writes the script, with Codex assistance in the pilot workflow. Workers AI narrates reviewed scripts. There is no autonomous factual verification or script writer. Storing guidance does not automatically certify that prose complies with it.

## Coverage and history

Preserve source provenance, clustering, initial freshness, and the single substantive, reviewed 24–48-hour follow-up. Select follow-ups using only their approved new evidence for scoring, source attribution, and publisher time. Brief coverage creates the same follow-up window as deeper coverage. Draft creation, script storage, and audio rendering never confirm actual coverage.

The first AI-only private pilot remains a historical draft with the wrong editorial scope. Old snapshots and evidence are immutable. Retired narrow feeds stay disabled while their evidence remains available for historical follow-ups.
