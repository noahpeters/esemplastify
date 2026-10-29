PRAGMA foreign_keys = ON;
CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, publisher TEXT NOT NULL, category TEXT NOT NULL, region TEXT NOT NULL, primary_source INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, last_success TEXT, last_error TEXT, etag TEXT, modified TEXT);
CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE TABLE articles (id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), canonical_url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL, published_at TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
CREATE INDEX articles_story ON articles(story_id);
CREATE TABLE evidence (id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES articles(id), source_id TEXT NOT NULL REFERENCES sources(id), content_hash TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, observed_at TEXT NOT NULL, published_at TEXT, raw_key TEXT NOT NULL, guid TEXT, UNIQUE(article_id, source_id, content_hash));
CREATE INDEX evidence_article ON evidence(article_id, observed_at);
CREATE TABLE fetches (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), fetched_at TEXT NOT NULL, status INTEGER NOT NULL, raw_key TEXT, item_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE episodes (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, target_minutes INTEGER NOT NULL, lineup_json TEXT NOT NULL);
CREATE TABLE coverage (story_id TEXT NOT NULL REFERENCES stories(id), kind TEXT NOT NULL CHECK(kind IN ('initial','followup')), episode_id TEXT NOT NULL REFERENCES episodes(id), covered_at TEXT NOT NULL, evidence_ids TEXT NOT NULL, PRIMARY KEY(story_id,kind));
CREATE TABLE verifications (story_id TEXT PRIMARY KEY REFERENCES stories(id), evidence_ids TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE followups (story_id TEXT PRIMARY KEY REFERENCES stories(id), due_at TEXT NOT NULL, expires_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','completed','expired')));

CREATE INDEX stories_first_seen ON stories(first_seen);
CREATE INDEX stories_last_seen ON stories(last_seen);
CREATE INDEX followups_pending ON followups(state,expires_at);
