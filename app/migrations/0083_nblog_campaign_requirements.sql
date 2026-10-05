-- 체험단 요구사항(가이드라인·키워드·필수 문구)을 캠페인에 저장한다.
-- 지금까지 이 값들은 로컬 campaign.yaml 에만 있어 Worker 생성이 볼 수 없었고,
-- 체험단 링크 가져오기(/api/nblog/campaign-imports/inspect)가 긁어온 가이드라인도
-- 화면에 채워주기만 하고 버려졌다.
ALTER TABLE nblog_campaigns ADD COLUMN requirements TEXT NOT NULL DEFAULT '';
