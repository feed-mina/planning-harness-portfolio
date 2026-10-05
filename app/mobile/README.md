# AI FeedYERIN mobile shell

`app/public/`을 단일 웹 자산 원본으로 유지하면서 Capacitor로 Android/iOS 앱을 만드는 패키지다. 프로덕션 앱은 원격 `server.url`을 열지 않고 `www/`에 동기화한 로컬 자산을 포함한다.

## 확정된 기준

- Capacitor `8.4.0`과 Node.js 22 이상을 사용한다.
- 앱 ID는 `io.github.feedmina.aifeedyerin`, 앱 이름은 `AI FeedYERIN`이다.
- Play Store 등록 후에는 앱 ID를 변경하지 않는다.
- `www/`는 생성물이므로 직접 수정하거나 커밋하지 않는다.
- `android/`와 `ios/`는 Capacitor가 생성한 소스 프로젝트로 커밋한다.
- 네이티브 런타임에서는 PWA 서비스 워커를 등록하지 않는다.
- API origin과 모바일 인증은 ADR-002/003에 따라 후속 PR에서 구현한다.

앱 ID는 Apple/Google 개발자 계정과 소유 도메인을 확정할 때 한 번만 변경한다. 스토어 레코드나 서명 인증서를 만든 뒤에는 변경하지 않는다.

## 자산 동기화

```powershell
cd app/mobile
npm.cmd install
npm.cmd run build:web
npm.cmd run cap:sync
```

`build:web`은 기존 `www/`를 지우고 `app/public/` 전체를 다시 복사한다. 웹 변경 후 네이티브 프로젝트를 열기 전에는 항상 `npm run cap:sync`를 실행한다.
Windows에서 `cap sync`가 iOS Swift package 상대 경로를 역슬래시로 생성할 수 있으므로 `cap:sync`는 마지막에 경로를 POSIX 구분자로 정규화한다.

## Play Store release AAB

AAB를 빌드하기 전에 production Worker(`https://harness-meeting-app.kibayerin.workers.dev`)로
자산을 동기화해야 한다.
기본 `build:web` 명령은 의도적으로 staging을 사용한다.

Windows PowerShell:

```powershell
npm.cmd run cap:sync:release
cd android
.\gradlew.bat bundleRelease -PversionCode=2
# 2를 Play Console의 다음 versionCode로 교체한다.
```

macOS/Linux에서는 같은 명령을 `npm`과 `./gradlew`로 실행한다.

release 빌드 전에 `android/key.properties`와 upload keystore가 로컬에 있어야
한다. keystore는 이 저장소 외부에 보관한다. 명령의 `2`를 Play 업로드마다
1씩 증가한 실제 정수로 교체해야 한다(`-PversionCode`는 필수).
최초 업로드는 `1`로 시작하고, 이후에는 Play Console의 마지막 업로드 값보다
큰 다음 정수를 사용한다.
`versionName`은 사용자에게 표시되는 release 버전이다.

최초 Play Console 등록 후 Play App Signing을 활성화하고 서명된
`android/app/build/outputs/bundle/release/app-release.aab`를 업로드한다.

## 네이티브 프로젝트 생성

최초 한 번만 실행한다.

```powershell
npm.cmd run build:web
npx.cmd cap add android
npx.cmd cap add ios
```

이후에는 다음 명령을 사용한다.

```powershell
npm.cmd run cap:sync
npm.cmd run cap:open:android
npm.cmd run cap:open:ios
```

## 개발 환경

- 공통: Node.js 22 이상
- Android: Android Studio 2025.2.1 이상, Android SDK API 24 이상
- iOS: macOS, Xcode 26 이상. Capacitor 8의 기본 의존성 관리자는 Swift Package Manager다.

Windows에서는 iOS 빌드와 Simulator 검증을 할 수 없다. Android Studio/SDK가 없는 환경에서는 프로젝트 생성과 정적 검증까지만 가능하다.

## 검증

```powershell
npm.cmd test
npm.cmd run build:web
npm.cmd run cap:sync
npm.cmd run cap:sync:android
```

웹/PWA 회귀는 상위 `app/` 패키지에서 실행한다.

```powershell
cd ..
npm.cmd test
npm.cmd run typecheck
```

## 회의록 Markdown 공유

- 웹에서는 `.md` Blob 다운로드를 유지한다.
- Android/iOS 앱에서는 Filesystem 캐시의 `shared-markdown/<일회용 ID>/`에 파일을 만든 뒤 OS 공유 시트를 연다.
- 공유 완료, 사용자 취소, 플러그인 오류 모두 파일과 일회용 폴더를 정리한다. 정리 실패는 민감한 회의록 잔존 가능성이 있으므로 오류로 표시한다.
- 앱 시작과 각 공유 직전에 `shared-markdown/` 루트를 재귀 정리해 강제 종료로 남은 일회용 파일도 다음 실행에서 제거한다. 공유 작업은 직렬화해 정리 중인 파일과 새 공유 파일이 충돌하지 않게 한다.
- Android `FileProvider`는 `shared-markdown/` 캐시 하위만 공개하며 외부 저장소 권한은 요청하지 않는다.
- iOS `PrivacyInfo.xcprivacy`는 Filesystem의 파일 타임스탬프 접근 이유 `C617.1`을 선언하고 앱 타깃 리소스에 포함된다.

실기기에서는 메일·메신저·파일 앱으로 UTF-8 한국어 Markdown이 열리는지, 공유 취소 후 재공유가 가능한지, 앱 재시작 후 캐시 파일이 남지 않는지를 Android와 iOS에서 각각 확인한다.

## GitHub Actions Android CI

`.github/workflows/mobile-android.yml`은 `app/mobile/**` 또는 `app/public/**` 변경이
포함된 pull request와 `main` push에서 clean Ubuntu runner로 실행된다.

- Node.js 22, JDK 21, Android SDK 36을 명시적으로 준비한다.
- 모바일 의존성을 `npm ci`로 설치하고 자산 계약 테스트를 실행한다.
- staging Worker 자산으로 `testDebugUnitTest`와 `assembleDebug`를 실행한다.
- production Worker 자산으로 `bundleRelease`를 실행해 release 패키징만 검증한다.
- 설치 가능한 staging debug APK만 7일 동안 Actions artifact로 보관한다.

CI에는 upload keystore나 서명 비밀번호를 넣지 않는다. CI가 만드는 release AAB는
**무서명 패키징 검증물**이며 artifact로 업로드하거나 Play Console에 배포하지 않는다.
실제 Play 업로드는 저장소 밖의 upload keystore를 사용해 앞 절의 절차로 만든 서명된
AAB만 사용한다.

## 직접 편집 경계

| 경로 | 관리 방식 |
| --- | --- |
| `app/public/` | 웹/PWA/모바일 공통 자산의 원본 |
| `app/mobile/www/` | 동기화 생성물, 커밋 금지 |
| `app/mobile/capacitor.config.ts` | 앱 공통 네이티브 설정 |
| `app/mobile/android/` | Android Studio에서 관리하는 소스 프로젝트 |
| `app/mobile/ios/` | Xcode에서 관리하는 소스 프로젝트 |
