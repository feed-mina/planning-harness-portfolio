> **포트폴리오용 사본** — 원본 저장소(비공개)의 스냅샷입니다. 회사 데이터는 원본에도 없었고, 배포 식별자(D1 ID)와 연락처는 자리표시자로 바꿨습니다. 이력 없이 1커밋으로 시작했습니다.

## 공개 배포 (포트폴리오 사본)

- 라이브 데모: https://harness-meeting-app.kibayerin.workers.dev (원본 저장소에서 운영, 이 사본은 재배포하지 않음)
- `docs/` 정적 웹앱만 따로 올릴 수 있다: `npx wrangler deploy --config wrangler.docs.toml` — D1·R2·시크릿 불필요. 2026-10-05 기준 미배포.

# 기획 하네스 - 빠른 시작 가이드 (10분)

> **목표**: 기획자가 명령어 한 줄로 상세기획 산출물을 자동 생성하는 환경

---

## 🚀 빠른 시작 (5분)

### 1단계: 환경 준비

```bash
# 저장소 클론
git clone https://github.com/OWNER/REPOSITORY.git
cd planning-harness

# Python 3.9+ 설치 확인
python --version
```

### 2단계: 기획 루프 시작

```bash
# 1️⃣ 회의록 준비
cp planning-harness/templates/meeting_template.md meetings/summary/2026-06-30_meeting.md

# 2️⃣ GitHub Issues 자동 생성
python scripts/create_github_issues.py 2026-06-30

# 3️⃣ Git Project V2 동기화
python scripts/sync_project.py --labels from-meeting,todo
```

### 3단계: 결과 확인

✅ GitHub Issues 생성됨
✅ Project V2에 자동 추가됨
✅ 완료!

---

## 📋 7개 스킬 사용법

### 1️⃣ `/search-documents` - 근거 자료 검색
```bash
"/search-documents 사용자 인증 프로세스"
→ 기존 문서 + Issues 자동 검색
```

### 2️⃣ `/split-requirements` - 요구사항 분해
```bash
"/split-requirements 사용자 대시보드 기능"
→ Phase 별 요구사항 + 의존성 그래프
```

### 3️⃣ `/sequence-diagram` - 시퀀스 다이어그램
```bash
"/sequence-diagram 로그인 플로우"
→ Mermaid 다이어그램 생성
```

### 4️⃣ `/user-flow` - 사용자 플로우
```bash
"/user-flow 회원가입 프로세스"
→ 사용자 경로 시각화
```

### 5️⃣ `/logic-check` - 테스트 케이스
```bash
"/logic-check 결제 기능"
→ 테스트 케이스 자동 도출
```

### 6️⃣ `/release-note` - 변경사항 요약
```bash
"/release-note v1.0.0 로그인 개선"
→ Slack 용 요약 생성
```

### 7️⃣ `/git-project-sync` - Project V2 동기화
```bash
"/git-project-sync 2026-06-30"
→ Issues 자동 생성 + Project 추가
```

---

## 📁 폴더 구조

```
planning-harness/
├── CLAUDE.md              ← AI 규칙서
├── spec.md                ← 진실의 원천
├── README.md              ← 이 파일
├── SETUP.md               ← 초기 설정
├── .claude/commands/      ← 7개 스킬
├── outputs/               ← 산출물 (자동)
└── templates/             ← 템플릿
```

---

## ✅ 체크리스트

```
□ CLAUDE.md 읽음
□ spec.md 이해함
□ 환경 변수 설정함
□ 첫 회의록 작성함
□ Issues 자동 생성 성공
□ Project V2 동기화 확인
```

---

**성공을 기원합니다! 🚀**

## 자동 발행

원본 저장소에서 `PUBLISH_REPOSITORY` Variable과 `GH_PAT` Secret을 설정하면 `planning-harness/**` 변경을 `main`에 push할 때 대상 저장소로 자동 동기화됩니다.
