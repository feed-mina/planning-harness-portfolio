-- settings 확장: 마이페이지 provider/model + 커스텀 프롬프트
ALTER TABLE settings ADD COLUMN default_model TEXT;
ALTER TABLE settings ADD COLUMN custom_prompt TEXT;
