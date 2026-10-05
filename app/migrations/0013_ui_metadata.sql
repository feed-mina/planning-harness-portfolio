CREATE TABLE IF NOT EXISTS ui_metadata (
  page_key       TEXT NOT NULL,
  node_id        TEXT NOT NULL,
  component_type TEXT NOT NULL,
  props_json     TEXT NOT NULL DEFAULT '{}',
  parent_node_id TEXT,
  group_direction TEXT,
  order_index    INTEGER NOT NULL DEFAULT 0,
  action_type    TEXT,
  ref_data_id    TEXT,
  allowed_roles  TEXT,
  created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (page_key, node_id)
);

CREATE INDEX IF NOT EXISTS idx_ui_metadata_page_parent
  ON ui_metadata (page_key, parent_node_id, order_index);

INSERT OR REPLACE INTO ui_metadata
  (page_key, node_id, component_type, props_json, parent_node_id, group_direction, order_index, action_type, ref_data_id, allowed_roles)
VALUES
  ('dev-setup', 'root', 'GROUP', '{"className":"sdui-root"}', NULL, 'COLUMN', 0, NULL, NULL, NULL),
  ('dev-setup', 'title', 'TEXT', '{"as":"h1","text":"개발환경 세팅환경"}', 'root', NULL, 0, NULL, NULL, NULL),
  ('dev-setup', 'lead', 'TEXT', '{"as":"p","className":"lead","text":"처음 세팅하는 Windows PC에서 필요한 개발 도구를 고르고 설치 스크립트를 내려받아 검토한 뒤 관리자 PowerShell에서 실행합니다."}', 'root', NULL, 1, NULL, NULL, NULL),

  ('dev-setup', 'toolPanel', 'GROUP', '{"as":"section","className":"panel"}', 'root', 'COLUMN', 2, NULL, NULL, NULL),
  ('dev-setup', 'toolHead', 'GROUP', '{"className":"result-head"}', 'toolPanel', 'ROW', 0, NULL, NULL, NULL),
  ('dev-setup', 'toolHeadCopy', 'GROUP', '{}', 'toolHead', 'COLUMN', 0, NULL, NULL, NULL),
  ('dev-setup', 'toolLabel', 'TEXT', '{"as":"div","className":"field-label","text":"설치할 도구"}', 'toolHeadCopy', NULL, 0, NULL, NULL, NULL),
  ('dev-setup', 'toolHint', 'TEXT', '{"as":"p","className":"hint","text":"Claude Code와 Codex를 선택하면 Node.js LTS가 자동으로 포함됩니다."}', 'toolHeadCopy', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'selectAllTools', 'BUTTON', '{"className":"btn btn-ghost btn-small","text":"전체 선택"}', 'toolHead', NULL, 1, 'SELECT_ALL_TOOLS', NULL, NULL),
  ('dev-setup', 'toolList', 'GROUP', '{"domId":"toolList","className":"tool-list"}', 'toolPanel', 'COLUMN', 1, NULL, 'dev_setup_catalog', NULL),

  ('dev-setup', 'tool-vscode', 'CHECKBOX', '{"className":"tool-item","value":"vscode","checked":true,"label":"VS Code","description":"코드 편집기 · winget: Microsoft.VisualStudioCode","badge":"확정"}', 'toolList', NULL, 0, NULL, NULL, NULL),
  ('dev-setup', 'tool-git', 'CHECKBOX', '{"className":"tool-item","value":"git","checked":true,"label":"Git Bash","description":"Git CLI와 Git Bash · winget: Git.Git","badge":"확정"}', 'toolList', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'tool-notepadpp', 'CHECKBOX', '{"className":"tool-item","value":"notepadpp","checked":true,"label":"Notepad++","description":"가벼운 텍스트 편집기 · winget: Notepad++.Notepad++","badge":"확정"}', 'toolList', NULL, 2, NULL, NULL, NULL),
  ('dev-setup', 'tool-obsidian', 'CHECKBOX', '{"className":"tool-item","value":"obsidian","checked":true,"label":"Obsidian","description":"로컬 Markdown 노트 · winget: Obsidian.Obsidian","badge":"확정"}', 'toolList', NULL, 3, NULL, NULL, NULL),
  ('dev-setup', 'tool-claude-code', 'CHECKBOX', '{"className":"tool-item","value":"claude-code","checked":true,"label":"Claude Code","description":"Anthropic Claude Code CLI · npm: @anthropic-ai/claude-code","badge":"npm fallback"}', 'toolList', NULL, 4, NULL, NULL, NULL),
  ('dev-setup', 'tool-codex', 'CHECKBOX', '{"className":"tool-item","value":"codex","checked":true,"label":"Codex","description":"OpenAI Codex CLI · npm: @openai/codex","badge":"npm fallback"}', 'toolList', NULL, 5, NULL, NULL, NULL),
  ('dev-setup', 'tool-nodejs', 'CHECKBOX', '{"className":"tool-item tool-item-runtime","value":"nodejs","checked":false,"disabled":true,"label":"Node.js LTS","description":"Claude Code와 Codex CLI 설치에 필요한 런타임 · winget: OpenJS.NodeJS.LTS","badge":"자동 포함"}', 'toolList', NULL, 6, NULL, NULL, NULL),

  ('dev-setup', 'previewPanel', 'GROUP', '{"as":"section","className":"panel"}', 'root', 'COLUMN', 3, NULL, NULL, NULL),
  ('dev-setup', 'previewHead', 'GROUP', '{"className":"result-head"}', 'previewPanel', 'ROW', 0, NULL, NULL, NULL),
  ('dev-setup', 'previewHeadCopy', 'GROUP', '{}', 'previewHead', 'COLUMN', 0, NULL, NULL, NULL),
  ('dev-setup', 'previewLabel', 'TEXT', '{"as":"div","className":"field-label","text":"dry-run 미리보기"}', 'previewHeadCopy', NULL, 0, NULL, NULL, NULL),
  ('dev-setup', 'previewHint', 'TEXT', '{"as":"p","className":"hint","text":"아래 명령만 조합합니다. 입력값은 서버 허용 목록에서만 처리합니다."}', 'previewHeadCopy', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'selectionCount', 'TEXT', '{"as":"span","domId":"selectionCount","className":"usage-pill","text":"0개 선택"}', 'previewHead', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'previewBox', 'TEXT', '{"as":"pre","domId":"previewBox","className":"script-preview","text":"미리보기를 준비 중입니다."}', 'previewPanel', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'warningList', 'GROUP', '{"as":"ul","domId":"warningList","className":"setup-warnings"}', 'previewPanel', 'COLUMN', 2, NULL, NULL, NULL),
  ('dev-setup', 'approvePreview', 'CHECKBOX', '{"domId":"approvePreview","className":"gate-row setup-gate","role":"approval","value":"approve-preview","label":"설치 항목과 명령 미리보기를 확인했습니다."}', 'previewPanel', NULL, 3, NULL, NULL, NULL),
  ('dev-setup', 'resultActions', 'GROUP', '{"className":"result-actions"}', 'previewPanel', 'ROW', 4, NULL, NULL, NULL),
  ('dev-setup', 'downloadScript', 'BUTTON', '{"domId":"downloadScript","className":"btn btn-primary","text":"dev-setup.ps1 다운로드","disabled":true}', 'resultActions', NULL, 0, 'DOWNLOAD_SETUP_SCRIPT', NULL, NULL),
  ('dev-setup', 'setupStatus', 'TEXT', '{"as":"span","domId":"setupStatus","className":"hint","text":""}', 'resultActions', NULL, 1, NULL, NULL, NULL),

  ('dev-setup', 'guidePanel', 'GROUP', '{"as":"section","className":"panel"}', 'root', 'COLUMN', 4, NULL, NULL, NULL),
  ('dev-setup', 'guideLabel', 'TEXT', '{"as":"div","className":"field-label","text":"실행 안내"}', 'guidePanel', NULL, 0, NULL, NULL, NULL),
  ('dev-setup', 'guide1', 'TEXT', '{"as":"p","className":"hint","text":"1. 다운로드한 dev-setup.ps1 내용을 확인합니다."}', 'guidePanel', NULL, 1, NULL, NULL, NULL),
  ('dev-setup', 'guide2', 'TEXT', '{"as":"p","className":"hint","text":"2. PowerShell에서 Set-ExecutionPolicy -Scope Process Bypass를 적용한 뒤 실행합니다."}', 'guidePanel', NULL, 2, NULL, NULL, NULL),
  ('dev-setup', 'guide3', 'TEXT', '{"as":"p","className":"hint","text":"3. 관리자 권한이 아니면 스크립트가 관리자 PowerShell로 다시 실행됩니다."}', 'guidePanel', NULL, 3, NULL, NULL, NULL),
  ('dev-setup', 'guide4', 'TEXT', '{"as":"p","className":"hint","text":"4. winget이 없으면 App Installer 설치 안내로 이어집니다."}', 'guidePanel', NULL, 4, NULL, NULL, NULL),
  ('dev-setup', 'foot', 'TEXT', '{"as":"p","className":"foot","text":"기획 하네스 루프"}', 'root', NULL, 5, NULL, NULL, NULL);
