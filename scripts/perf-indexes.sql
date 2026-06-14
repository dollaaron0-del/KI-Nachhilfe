-- ============================================================================
-- Performance-Indizes für die postgres-EIGENEN Tabellen
-- ============================================================================
--
-- WARUM separat / nicht in initTables(): Diese Tabellen (documents, messages,
-- quiz_results, flashcards, glossar, subjects) gehören dem postgres-Hauptbenutzer,
-- nicht dem App-Benutzer. Nur der Eigentümer (oder ein Superuser) darf einen Index
-- anlegen – der App-Code kann das also NICHT, deshalb dieser manuelle Schritt.
--
-- AUSFÜHREN (als Tabellen-Eigentümer, z.B. auf dem Server):
--     sudo -u postgres psql <DEINE_DATENBANK> -f scripts/perf-indexes.sql
--   oder interaktiv:
--     sudo -u postgres psql <DEINE_DATENBANK>
--     \i scripts/perf-indexes.sql
--
-- SICHER & WIEDERHOLBAR:
--   * IF NOT EXISTS  → mehrfaches Ausführen schadet nicht (legt nichts doppelt an).
--   * CONCURRENTLY   → baut den Index OHNE die Tabelle für Lese-/Schreibzugriffe
--                      zu sperren. Wichtig im laufenden Betrieb. Nachteil: darf
--                      NICHT in einem Transaktionsblock laufen (also kein BEGIN/COMMIT
--                      drumherum – psql führt jede Zeile einzeln aus, das passt).
--   * Bei einer noch winzigen DB ist CONCURRENTLY egal; du könntest es weglassen.
--
-- Reihenfolge der Spalten zählt: zuerst die Filter-Spalte (WHERE subject_id),
-- dann die Sortier-Spalte (ORDER BY ...). So deckt EIN Index Filter + Sortierung ab.
-- ============================================================================

-- 1) messages: WHERE subject_id ORDER BY created_at  (jeder Chat-Aufruf) ── HEISS
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_subject_created
  ON messages (subject_id, created_at);

-- 2) documents: WHERE subject_id ORDER BY uploaded_at  (Doku-Liste + RAG-Fallback)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_subject_uploaded
  ON documents (subject_id, uploaded_at);

-- 3) documents-Volltext: to_tsvector('german', content) @@ plainto_tsquery(...)
--    Der größte RAG-Hebel. Der GIN-Ausdruck MUSS exakt dem in der Query genutzten
--    to_tsvector('german', content) entsprechen, sonst nutzt der Planner ihn nicht.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_content_fts
  ON documents USING gin (to_tsvector('german', content));

-- 4) subjects: WHERE user_id ORDER BY created_at  (Fächerliste beim App-Start) ── HEISS
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subjects_user_created
  ON subjects (user_id, created_at);

-- 5) quiz_results: WHERE subject_id ORDER BY taken_at  (Statistik/Fortschritt)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quiz_subject_taken
  ON quiz_results (subject_id, taken_at);

-- 6) flashcards: WHERE subject_id  (Karten laden + Fällig-Zählung)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flashcards_subject
  ON flashcards (subject_id);

-- 7) glossar: WHERE subject_id ORDER BY term  (Glossar-Sheet)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_glossar_subject_term
  ON glossar (subject_id, term);

-- Frische Statistiken für den Query-Planner (autovacuum holt das sonst irgendwann nach).
ANALYZE messages;
ANALYZE documents;
ANALYZE subjects;
ANALYZE quiz_results;
ANALYZE flashcards;
ANALYZE glossar;

-- Kontrolle danach (zeigt die neuen Indizes):
--   \di idx_*
-- Prüfen, ob ein Index wirklich genutzt wird (Beispiel RAG-Volltext):
--   EXPLAIN ANALYZE
--   SELECT 1 FROM documents
--   WHERE subject_id='...' AND to_tsvector('german', content) @@ plainto_tsquery('german', 'test');
-- → im Plan sollte "Bitmap Index Scan on idx_documents_content_fts" statt "Seq Scan" stehen.
