-- Issue #105: connect user-owned Gardens to an organization without
-- changing the Garden owner's private API scope.
CREATE TABLE IF NOT EXISTS organization_gardens (
  org_id     TEXT NOT NULL,
  garden_id  TEXT NOT NULL,
  linked_by  TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'org_private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, garden_id),
  CHECK (visibility IN ('org_private'))
);

CREATE INDEX IF NOT EXISTS idx_organization_gardens_garden
  ON organization_gardens (garden_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_organization_gardens_org
  ON organization_gardens (org_id, updated_at DESC);

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('garden', 'garden.form.organization', 'WIDGET', '{"domId":"gardenOrganizationLinker","className":"garden-organization-linker"}', 'garden.form.panel', NULL, 7, NULL, 'garden_organization_linker', 'user');

UPDATE ui_metadata SET order_index=8 WHERE page_key='garden' AND node_id='garden.form.publishSections';
UPDATE ui_metadata SET order_index=9 WHERE page_key='garden' AND node_id='garden.taxonomy';
UPDATE ui_metadata SET order_index=10 WHERE page_key='garden' AND node_id='garden.form.actions';
