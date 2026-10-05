-- Complete issue #83: source references, generated URL and uploaded logo.

CREATE TABLE IF NOT EXISTS garden_assets (
  id TEXT PRIMARY KEY,
  garden_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('logo')),
  name TEXT NOT NULL,
  type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (garden_id) REFERENCES gardens(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_garden_assets_kind
  ON garden_assets (garden_id, user_id, kind);

DELETE FROM ui_metadata
WHERE page_key='garden'
  AND node_id IN ('garden.form.baseInput', 'garden.form.logoInput');

UPDATE ui_metadata
SET props_json='{"as":"span","domId":"gardenBaseUrl","className":"generated-url-status","text":"저장 후 자동 생성됩니다"}',
    component_type='TEXT',
    updated_at=CURRENT_TIMESTAMP
WHERE page_key='garden' AND node_id='garden.form.baseLabel';

UPDATE ui_metadata
SET props_json='{"domId":"gardenLogoPicker","className":"garden-logo-picker"}',
    component_type='WIDGET',
    ref_data_id='garden_logo_picker',
    updated_at=CURRENT_TIMESTAMP
WHERE page_key='garden' AND node_id='garden.form.logoLabel';

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.form.sources', 'WIDGET', '{"domId":"gardenSourcePicker","className":"garden-source-picker"}', 'garden.form.panel', NULL, 3, NULL, 'garden_source_picker', 'provider:github');

UPDATE ui_metadata SET order_index=4 WHERE page_key='garden' AND node_id='garden.taxonomy';
UPDATE ui_metadata SET order_index=5 WHERE page_key='garden' AND node_id='garden.form.actions';
