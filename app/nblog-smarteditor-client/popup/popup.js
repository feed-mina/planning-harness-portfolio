"use strict";

const form = document.getElementById("connectForm");
const codeField = document.getElementById("connectionCode");
const connectButton = document.getElementById("connectButton");
const retryButton = document.getElementById("retryButton");
const statusBox = document.getElementById("status");

const STATUS_MESSAGES = Object.freeze({
  idle: ["준비", "네이버 블로그 글쓰기 탭에서 실행하세요."],
  target_blog_unverified: ["블로그 계정 확인 필요", "대상 블로그에서 열린 글쓰기 탭인지 직접 확인한 뒤 다시 시도하세요."],
  target_blog_mismatch: ["다른 블로그입니다", "지정된 대상 블로그의 글쓰기 화면으로 이동한 뒤 다시 시도하세요."],
  browser_connected: ["연결됨", "빈 SmartEditor 화면을 확인하고 있습니다."],
  input_in_progress: ["입력 중", "제목과 본문을 확인하고 있습니다."],
  user_action_required: ["직접 확인 필요", "빈 네이버 글쓰기 화면을 연 뒤 다시 확인하세요."],
  review_required: ["입력 완료", "사진·영상·장소를 추가하고 미리보기 후 직접 발행하세요."],
  invalid_code_prefix: ["연결 코드 오류", "NBlog 발행 화면에서 새 연결 코드를 복사하세요."],
  connection_expired: ["연결 코드 만료", "NBlog 발행 화면에서 10분 연결 코드를 다시 만드세요."],
  naver_editor_tab_required: ["네이버 탭 필요", "네이버 블로그 글쓰기 화면을 연 탭에서 실행하세요."],
  editor_not_found: ["편집기 확인 필요", "네이버 로그인 후 빈 글쓰기 화면이 보이면 다시 확인하세요."],
  editor_not_empty: ["기존 내용 보호", "이미 있는 내용과 달라 자동 입력을 멈췄습니다. 해당 필드만 지우고 같은 연결로 다시 시도할 수 있습니다."],
  selector_mismatch: ["편집기 변경 감지", "네이버 편집기 구조가 달라 안전하게 중단했습니다."],
});

const FIELD_LABEL = Object.freeze({ title: "제목", body: "본문", tags: "태그" });

// editor_not_empty에 diagnostics.conflicting_fields가 있으면 어떤 필드를 지워야 하는지 구체적으로 안내한다.
function editorNotEmptyDetail(result) {
  const fields = result?.diagnostics?.conflicting_fields;
  if (!Array.isArray(fields) || !fields.length) return "";
  const labels = fields.map((field) => FIELD_LABEL[field] || field).join("·");
  return `${labels}에 자동 입력과 다른 내용이 있어 멈췄습니다. ${labels}만 지우고 같은 연결로 다시 시도하세요.`;
}

function detailFor(response) {
  if (response?.code === "editor_not_empty") return editorNotEmptyDetail(response.result);
  return "";
}

function setStatus(key, detail = "") {
  const [title, message] = STATUS_MESSAGES[key] || ["처리하지 못했습니다", "새 연결 코드를 만든 뒤 다시 시도하세요."];
  statusBox.className = `status${key === "review_required" ? " is-success" : (STATUS_MESSAGES[key] && key !== "idle" && !["browser_connected", "input_in_progress"].includes(key) ? " is-error" : "")}`;
  statusBox.innerHTML = "";
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = title;
  span.textContent = detail || message;
  statusBox.append(strong, span);
}

async function activeTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return Number.isInteger(tabs[0]?.id) ? tabs[0].id : null;
}

async function requestHelper(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response) return { ok: false, code: "browser_helper_failed" };
  return response;
}

async function refreshStatus() {
  const response = await requestHelper({ type: "NBLOG_HELPER_STATUS_V1" });
  const job = response?.job;
  if (!response.ok || !job || job.status === "idle") {
    setStatus("idle");
    retryButton.hidden = true;
    return;
  }
  setStatus(job.status);
  retryButton.hidden = !["browser_connected", "input_in_progress", "user_action_required"].includes(job.status);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (connectButton.disabled) return;
  const code = codeField.value.trim();
  if (!code) return;
  connectButton.disabled = true;
  setStatus("input_in_progress", "일회성 연결 코드를 확인하고 있습니다.");
  try {
    const tabId = await activeTabId();
    const response = await requestHelper({
      type: "NBLOG_HELPER_CONNECT_V1",
      code,
      tab_id: tabId,
    });
    codeField.value = "";
    if (!response.ok) {
      setStatus(response.code, detailFor(response));
      // response.job이 있으면(claim 이후 실패) 세션이 저장돼 있어 같은 진행 상태로 이어서 재시도할 수 있다.
      retryButton.hidden = !response.job;
      return;
    }
    setStatus(response.job?.status || "review_required");
    retryButton.hidden = true;
  } catch {
    codeField.value = "";
    setStatus("browser_helper_failed");
  } finally {
    connectButton.disabled = false;
  }
});

retryButton.addEventListener("click", async () => {
  retryButton.disabled = true;
  setStatus("input_in_progress");
  try {
    const response = await requestHelper({
      type: "NBLOG_HELPER_RETRY_V1",
      tab_id: await activeTabId(),
    });
    if (!response.ok) {
      setStatus(response.code, detailFor(response));
      retryButton.hidden = !response.job;
      return;
    }
    setStatus(response.job?.status || "review_required");
    retryButton.hidden = response.ok;
  } catch {
    setStatus("browser_helper_failed");
  } finally {
    retryButton.disabled = false;
  }
});

refreshStatus();
