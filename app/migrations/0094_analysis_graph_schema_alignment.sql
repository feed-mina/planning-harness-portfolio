-- Repair environments that recorded both the legacy graph migration and 0069.
--
-- analysis_graph_* is a derived GraphRAG cache. At rollout time both production
-- and staging contain zero rows, and both D1 databases were backed up before
-- this migration. Rebuilding the cache tables is safer than keeping two
-- incompatible legacy and current endpoint column contracts.

DROP TABLE IF EXISTS analysis_graph_edges;
DROP TABLE IF EXISTS analysis_graph_nodes;

CREATE TABLE analysis_graph_nodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, user_id, normalized_name)
);

CREATE TABLE analysis_graph_edges (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  source_chunk_id TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, user_id, source_node_id, target_node_id, source_chunk_id)
);

CREATE INDEX idx_analysis_graph_nodes_session
  ON analysis_graph_nodes(session_id, user_id, normalized_name);
CREATE INDEX idx_analysis_graph_edges_session
  ON analysis_graph_edges(session_id, user_id, source_node_id, target_node_id);
CREATE INDEX idx_analysis_graph_edges_chunk
  ON analysis_graph_edges(source_chunk_id, user_id);
