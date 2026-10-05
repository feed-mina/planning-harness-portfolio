-- GraphRAG entities and co-occurrence edges derived from analysis chunks.
CREATE TABLE IF NOT EXISTS analysis_graph_nodes (
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

CREATE TABLE IF NOT EXISTS analysis_graph_edges (
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

CREATE INDEX IF NOT EXISTS idx_analysis_graph_nodes_session
  ON analysis_graph_nodes(session_id, user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_analysis_graph_edges_session
  ON analysis_graph_edges(session_id, user_id, source_node_id, target_node_id);
CREATE INDEX IF NOT EXISTS idx_analysis_graph_edges_chunk
  ON analysis_graph_edges(source_chunk_id, user_id);
