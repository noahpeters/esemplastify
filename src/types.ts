export interface Env { DB: D1Database; EVIDENCE: R2Bucket; INGEST: Queue<IngestJob>; ADMIN_TOKEN?: string }
export interface IngestJob { sourceId: string }
export interface Source { id: string; name: string; url: string; publisher: string; category: string; region: string; primary_source: number; aiOnly?: boolean; etag?: string; modified?: string }
export interface FeedItem { title: string; url: string; summary: string; publishedAt: string | null; guid: string | null }
export interface Evidence { id: string; article_id: string; source_id: string; content_hash: string; title: string; summary: string; observed_at: string; published_at: string | null; raw_key: string; publisher: string; primary_source: number; region: string; canonical_url: string }
export interface Candidate { id: string; title: string; category: string; first_seen: string; last_seen: string; evidence: Evidence[]; initial?: { covered_at: string; evidence_ids: string }; followup?: { due_at: string; expires_at: string; state: string }; verification?: { evidence_ids: string; note: string }; completed: boolean }
