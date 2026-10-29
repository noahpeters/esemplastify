CREATE TABLE pilots (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','queued','rendering','ready','failed')),
 script_key TEXT NOT NULL, audio_key TEXT, model TEXT NOT NULL, speaker TEXT NOT NULL,
 word_count INTEGER NOT NULL, character_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
 duration_seconds REAL, last_error TEXT
);
CREATE TABLE pilot_chunks (
 pilot_id TEXT NOT NULL REFERENCES pilots(id), ordinal INTEGER NOT NULL,
 text TEXT NOT NULL, text_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
 audio_key TEXT, duration_seconds REAL, byte_count INTEGER, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 PRIMARY KEY(pilot_id,ordinal)
);
CREATE TABLE pilot_evidence (
 pilot_id TEXT NOT NULL REFERENCES pilots(id), story_id TEXT NOT NULL REFERENCES stories(id),
 evidence_id TEXT NOT NULL REFERENCES evidence(id), PRIMARY KEY(pilot_id,evidence_id)
);
CREATE INDEX pilot_created ON pilots(created_at);
