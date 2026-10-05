-- Cloudflare Pages is the only user-facing deployment target.
UPDATE ui_metadata
SET props_json = '{"as":"label","hidden":true}', updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'garden' AND node_id = 'garden.form.targetLabel';

UPDATE ui_metadata
SET component_type = 'SELECT',
    props_json = '{"domId":"gardenPublishLabel","value":"audience:business","options":[{"value":"audience:business","label":"업무 공개 (audience:business)"},{"value":"public","label":"전체 공개 (public)"},{"value":"internal","label":"내부 공유 (internal)"}]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'garden' AND node_id = 'garden.form.labelInput';

UPDATE ui_metadata
SET component_type = 'SELECT',
    props_json = '{"domId":"gardenIssuesDir","value":"Knowledge/Issues","options":[{"value":"Knowledge/Issues","label":"Knowledge/Issues (기본)"},{"value":"Issues","label":"Issues"},{"value":"docs/issues","label":"docs/issues"},{"value":"content/issues","label":"content/issues"}]}',
    updated_at = CURRENT_TIMESTAMP
WHERE page_key = 'garden' AND node_id = 'garden.form.pathInput';
