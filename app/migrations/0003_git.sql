-- M5 git 연동: OAuth 토큰 저장 + 기본 Project(V2) 대상
-- 적용: wrangler d1 migrations apply harness-meeting-db [--local|--remote]

-- GitHub 액세스 토큰(암호화 저장, AES-GCM). 이슈/프로젝트 API 호출에 사용.
ALTER TABLE users ADD COLUMN gh_token TEXT;
ALTER TABLE users ADD COLUMN gh_scope TEXT;

-- 기본 git 대상: default_repo(owner/name)는 0001에 이미 있음.
-- Projects V2 는 숫자 대신 node id(문자열)라 별도 컬럼으로 저장(legacy default_project INTEGER 는 미사용).
ALTER TABLE settings ADD COLUMN default_project_id TEXT;
ALTER TABLE settings ADD COLUMN default_project_title TEXT;
