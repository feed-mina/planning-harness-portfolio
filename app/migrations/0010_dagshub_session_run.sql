-- 분석 세션당 단일 DagsHub(MLflow) run 을 재사용하기 위한 컬럼.
-- 첫 AI 단계에서 run 을 만들고 run_id/url 을 여기 저장, 이후 단계는 같은 run 에 이어 기록.
-- 상세 모달 상단 "신뢰도지표" 링크가 이 run_url 로 연결된다.
ALTER TABLE analysis_sessions ADD COLUMN dagshub_run_id TEXT;
ALTER TABLE analysis_sessions ADD COLUMN dagshub_run_url TEXT;
