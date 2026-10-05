const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "nblog-automation.js"), "utf8");

/**
 * 글 확인(content_confirmed) 후에는 음성메모 올리기를 잠근다 (Task #1).
 *
 * 확정된 뒤 음성메모를 더 올려도 그 초안에는 반영되지 않는다 — 다시 만들기를 해야
 * 반영되고 그러면 확정이 풀린다. 올릴 수 있어 보이면 혼란만 준다.
 */
function renderVoiceSection(view) {
  const fn = new RegExp("\\n  function sectionVoiceNotes\\([\\s\\S]*?\\n  \\}").exec(script)[0];
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const collapsible = (title, summary, body) => `<section>${title}|${summary}|${body}</section>`;
  return new Function("esc", "collapsible", `${fn}; return sectionVoiceNotes;`)(esc, collapsible)(view);
}

test("확정 전에는 올리고 받아쓰기 버튼이 있다", () => {
  const html = renderVoiceSection({ voiceNotes: [], campaign: { generation_status: "awaiting_content_review" } });

  assert.match(html, /data-detail-action="upload-voice-note"/);
  assert.doesNotMatch(html, /음성메모 올리기가 잠겼습니다/);
});

test("content_confirmed 면 버튼 대신 잠김 안내가 나온다", () => {
  const html = renderVoiceSection({ voiceNotes: [], campaign: { generation_status: "content_confirmed" } });

  assert.doesNotMatch(html, /data-detail-action="upload-voice-note"/);
  assert.match(html, /음성메모 올리기가 잠겼습니다/);
  assert.match(html, /잠김/);
});

test("잠겨도 기존 메모 보기·수정은 남는다", () => {
  const note = { note_id: "n1", original_name: "memo.m4a", transcript: "좋았어요", transcript_status: "ready" };
  const html = renderVoiceSection({ voiceNotes: [note], campaign: { generation_status: "content_confirmed" } });

  // 삭제·저장 버튼은 그대로 — 올리기만 막는다.
  assert.match(html, /data-detail-action="delete-voice-note"/);
  assert.match(html, /data-detail-action="save-voice-note"/);
});

test("campaign 이 없어도 렌더링이 죽지 않는다", () => {
  assert.doesNotThrow(() => renderVoiceSection({ voiceNotes: [] }));
});

test("핸들러도 확정 상태면 업로드를 막는다", () => {
  // 화면이 오래돼 버튼이 남아 있어도 확정 후에는 서버로 안 보낸다.
  const handler = script.match(/if \(action === "upload-voice-note"\) \{[\s\S]*?document\.getElementById\("voiceNoteInput"\)/)[0];

  assert.match(handler, /generation_status === "content_confirmed"/);
  assert.match(handler, /return;/);
});
