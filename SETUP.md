# 기획 하네스 - 초기 설정 가이드

> **목표**: 기획 루프 에이전트를 처음 설정하고 사용하기 위한 단계별 가이드

---

## 🔧 시스템 요구사항

### 필수 사항
- **Python**: 3.9 이상
- **Git**: 설치되어 있음
- **GitHub 계정**: 리포지토리 접근 가능

### 선택 사항
- **VS Code**: Copilot 플러그인과 함께
- **Claude**: claude.ai 또는 GitHub Copilot

---

## 📥 1단계: 저장소 준비

### 1-1. 저장소 클론

```bash
# HTTPS 사용
git clone https://github.com/OWNER/REPOSITORY.git
cd planning-harness

# 또는 SSH 사용
git clone git@github.com:OWNER/REPOSITORY.git
cd planning-harness
```

### 1-2. 폴더 구조 확인

```bash
ls -la .

# 예상 출력:
# CLAUDE.md
# spec.md
# README.md
# SETUP.md (이 파일)
# .claude/commands/
# outputs/
# templates/
```

---

## 🐍 2단계: Python 환경 구성

### 2-1. Python 버전 확인

```bash
python --version
# 또는
python3 --version

# 출력 예: Python 3.9.0 이상
```

### 2-2. 가상환경 생성 (권장)

```bash
# 가상환경 생성
python -m venv venv

# 활성화
# macOS/Linux:
source venv/bin/activate

# Windows:
venv\Scripts\activate
```

### 2-3. 의존성 설치

```bash
# 기본 설치 (필요할 때만)
pip install requests

# 또는 requirements.txt 사용
pip install -r requirements.txt
```

---

## 🔐 3단계: GitHub 인증 설정

### 3-1. GitHub Token 발급

1. **GitHub 설정**: https://github.com/settings/tokens
2. **"Generate new token" 클릭** → "Generate new token (classic)"
3. **권한 선택**:
   - ✅ `repo` (리포지토리 전체 접근)
   - ✅ `workflow` (GitHub Actions)
   - ✅ `admin:repo_hook` (웹훅)
4. **Token 복사** (다시 볼 수 없으므로 안전하게 보관)

### 3-2. 환경 변수 설정

#### macOS / Linux

```bash
# .bashrc 또는 .zshrc 에 추가
echo 'export GITHUB_TOKEN="ghp_xxxxxxxxxxxxx"' >> ~/.bashrc
echo 'export GITHUB_REPOSITORY="OWNER/REPOSITORY"' >> ~/.bashrc
echo 'export GITHUB_PROJECT_ID="1"' >> ~/.bashrc

# 변경사항 적용
source ~/.bashrc
```

#### Windows (PowerShell)

```powershell
# 환경 변수 설정
[Environment]::SetEnvironmentVariable('GITHUB_TOKEN', 'ghp_xxxxx', 'User')
[Environment]::SetEnvironmentVariable('GITHUB_REPOSITORY', 'OWNER/REPOSITORY', 'User')
[Environment]::SetEnvironmentVariable('GITHUB_PROJECT_ID', '1', 'User')

# PowerShell 재시작 후 확인
echo $env:GITHUB_TOKEN
```

#### 임시 설정 (현재 세션만)

```bash
export GITHUB_TOKEN="ghp_xxxxx"
export GITHUB_REPOSITORY="OWNER/REPOSITORY"
export GITHUB_PROJECT_ID="1"
```

### 3-3. 인증 확인

```bash
# 환경 변수 확인
echo $GITHUB_TOKEN
echo $GITHUB_REPOSITORY

# GitHub API 테스트
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/user

# 출력 예: {"login": "your-account", ...}
```

---

## 📁 4단계: 폴더 구조 준비

### 4-1. 필요한 디렉토리 생성

```bash
# 첫 번째 회의 폴더
mkdir -p outputs/2026-06-30

# 회의록 저장 폴더
mkdir -p meetings/summary

# 할 일 추적 폴더
mkdir -p Todo
```

### 4-2. 회의록 템플릿 준비

```bash
# 템플릿 복사
cp templates/meeting_template.md meetings/summary/2026-06-30_meeting.md

# 또는 직접 생성
cat > meetings/summary/2026-06-30_meeting.md << 'EOF'
# 2026-06-30 회의

## 참석자
- 담당자1
- 담당자2

## 회의 내용
기획 하네스 초기 설정

## 할 일
- [ ] 기획 하네스 초기 설정 — @담당자1 ~2026-07-05

EOF
```

---

## 🚀 5단계: 첫 실행 테스트

### 5-1. Python 스크립트 권한 설정

```bash
# macOS / Linux
chmod +x scripts/*.py

# 확인
ls -la scripts/*.py
```

### 5-2. Issues 생성 테스트 (드라이런)

```bash
# 결과 미리 보기
python scripts/create_github_issues.py 2026-06-30 --dry-run

# 출력 예:
# 📋 2026-06-30 회의 - 1개 할 일 항목
# 1. 기획 하네스 초기 설정
#    담당: @담당자1
#    마감: 2026-07-05
```

### 5-3. 실제 Issues 생성

```bash
# Issues 생성
python scripts/create_github_issues.py 2026-06-30

# 확인: GitHub 리포지토리의 Issues 탭에서 생성 확인
```

### 5-4. Project V2 동기화

```bash
# Project에 Issues 추가
python scripts/sync_project.py --labels from-meeting,todo

# 확인: GitHub Projects 탭에서 Issues 추가 확인
```

---

## 🤖 6단계: Claude AI 설정

### 6-1. Copilot 플러그인 설치 (VS Code)

1. **VS Code 열기**
2. **Extensions 탭** → "GitHub Copilot" 검색
3. **"Install" 클릭**
4. **GitHub로 로그인**
5. **"Allow" 클릭** (권한 승인)

### 6-2. claude.ai 웹 사용 (권장)

1. https://claude.ai 접속
2. **Chat 시작**
3. **파일 업로드** (planning-harness 폴더)
4. **명령어 실행**: `/search-documents 기획 하네스`

### 6-3. CLAUDE.md 읽기

```bash
# 로컬에서 읽기
cat CLAUDE.md

# 또는 편집기에서
vim CLAUDE.md
```

### 6-4. 첫 명령 테스트

```
Claude에게:
"/search-documents 기획 하네스"

예상 응답:
- 기존 문서 검색 결과
- 관련 GitHub Issues
```

---

## ✅ 7단계: 최종 확인

### 7-1. 체크리스트

```bash
# 1. Python 버전 확인
python --version

# 2. GitHub Token 설정
echo $GITHUB_TOKEN | head -c 10

# 3. 폴더 구조 확인
ls -la .

# 4. Scripts 확인
ls -la scripts/*.py

# 5. 회의록 준비
ls -la meetings/summary/
```

### 7-2. 전체 시스템 테스트 스크립트

```bash
#!/bin/bash
# test_setup.sh

echo "🔍 기획 하네스 설정 테스트 시작..."

# 1. Python 확인
echo "✓ Python: $(python --version)"

# 2. GitHub Token 확인
if [ -z "$GITHUB_TOKEN" ]; then
    echo "✗ GITHUB_TOKEN 미설정"
    exit 1
fi
echo "✓ GitHub Token: 설정됨"

# 3. 폴더 구조 확인
if [ -d "planning-harness" ]; then
    echo "✓ planning-harness 폴더: 존재"
else
    echo "✗ planning-harness 폴더: 없음"
    exit 1
fi

# 4. Scripts 확인
if [ -f "scripts/create_github_issues.py" ]; then
    echo "✓ create_github_issues.py: 존재"
else
    echo "✗ create_github_issues.py: 없음"
    exit 1
fi

echo "✅ 모든 설정 완료!"
```

---

## 🔧 트러블슈팅

### 문제 1: "Module not found: requests"

```bash
# 해결
pip install requests
```

### 문제 2: "GITHUB_TOKEN not set"

```bash
# 확인
echo $GITHUB_TOKEN

# 설정
export GITHUB_TOKEN="ghp_xxxxx"
```

### 문제 3: "GitHub API 403 Forbidden"

```bash
# 원인: 토큰 권한 부족
# 해결: 새 토큰 발급 (repo 권한 포함)
```

### 문제 4: 모바일에서 오류 발생

```
→ Desktop으로 전환
→ doc/mobile_github_copilot_error.md 참고
```

---

## 📖 다음 단계

1. ✅ **이 SETUP.md 완료**
2. 📋 **README.md 읽기** (기본 사용법)
3. 📚 **CLAUDE.md 읽기** (AI 규칙서)
4. ✍️ **spec.md 작성** (첫 기획)
5. 🚀 **7개 스킬 연습**

---

## 📞 지원

- **설정 문제**: GitHub Issues #44 에 코멘트
- **Python 문제**: Stack Overflow 또는 python.org
- **GitHub API**: docs.github.com/en/rest

**설정 완료! 이제 기획을 시작하세요! 🎉**
