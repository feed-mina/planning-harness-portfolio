-- Normalize SDUI footer copy across existing metadata rows.

UPDATE ui_metadata
SET props_json = replace(
  replace(
    props_json,
    '"text":"기획 허널 루프"',
    '"text":"기획 하네스 루프 프로젝트"'
  ),
  '"text":"기획 하네스 루프"',
  '"text":"기획 하네스 루프 프로젝트"'
)
WHERE props_json LIKE '%"className":"foot"%';
