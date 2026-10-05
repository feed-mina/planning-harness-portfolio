-- 실사용 산출물에 DagsHub(MLflow) run 링크를 저장해 마이페이지 히스토리 상세에서
-- 항목별 하이퍼링크로 노출하기 위한 컬럼. (분석 단계별 산출물 + 회의록)
ALTER TABLE analysis_outputs ADD COLUMN dagshub_run_url TEXT;
ALTER TABLE meetings ADD COLUMN dagshub_run_url TEXT;
