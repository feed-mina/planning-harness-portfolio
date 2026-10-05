const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const read = (relativePath) => fs.readFileSync(path.join(publicDir, relativePath), "utf8");
const script = read("assets/nblog-automation.js");

/**
 * 브라우저 번들에서 함수를 떼어 실행한다. sortByCaptureTime 이 captureTimeOf 를 부르므로
 * 필요한 함수를 함께 넣고 원하는 것만 꺼낸다.
 */
function extract(name, ...dependencies) {
  const source = [...dependencies, name]
    .map((fn) => new RegExp(`\\n  function ${fn}\\([\\s\\S]*?\\n  \\}`).exec(script)[0])
    .join("\n");
  return new Function(`${source}; return ${name};`)();
}

/**
 * 사진·영상 순서 (#194 후속).
 *
 * 파일 고르기 순서는 탐색기 정렬을 따라와서 찍은 차례와 어긋난다. 미생맥주 캠페인에서
 * 4번 카드가 19:29:11 이라 2번보다 앞서야 했는데 뒤에 있었다.
 */
const captureTimeOf = extract("captureTimeOf");
const sortByCaptureTime = extract("sortByCaptureTime", "captureTimeOf");

const file = (name, lastModified = 0) => ({ name, lastModified });

test("파일명의 촬영 시각을 읽는다", () => {
  const at = captureTimeOf(file("20260712_192901.mp4"), 0);

  assert.equal(at, Date.parse("2026-07-12T19:29:01"));
});

test("파일명에 시각이 없으면 파일 수정 시각을 쓴다", () => {
  assert.equal(captureTimeOf(file("receipt.jpg", 1_700_000_000_000), 3), 1_700_000_000_000);
});

test("둘 다 없으면 고른 순서를 유지한다", () => {
  assert.equal(captureTimeOf(file("scan.jpg", 0), 5), 5);
});

test("미생맥주 파일들이 찍은 차례로 정렬된다", () => {
  // 화면에 보이던 순서 — 4번(19:29:11)이 2번(19:31:50)보다 뒤에 있었다.
  const picked = [
    file("20260712_192901.mp4"), file("20260712_193150.mp4"), file("20260712_194232.mp4"),
    file("20260712_192911.mp4"), file("20260712_203058.mp4"), file("20260712_194511.mp4"),
    file("20260712_203127.jpg"),
  ];

  const sorted = sortByCaptureTime(picked).map((item) => item.name);

  assert.deepEqual(sorted, [
    "20260712_192901.mp4", "20260712_192911.mp4", "20260712_193150.mp4",
    "20260712_194232.mp4", "20260712_194511.mp4", "20260712_203058.mp4",
    "20260712_203127.jpg",
  ]);
});

test("영수증 사진이 마지막에 온다", () => {
  const sorted = sortByCaptureTime([
    file("20260712_203127.jpg"), file("20260712_192901.mp4"),
  ]);

  assert.equal(sorted.at(-1).name, "20260712_203127.jpg");
});

test("촬영 시각이 같으면 고른 순서를 지킨다", () => {
  const sorted = sortByCaptureTime([file("a.jpg", 0), file("b.jpg", 0), file("c.jpg", 0)]);

  assert.deepEqual(sorted.map((item) => item.name), ["a.jpg", "b.jpg", "c.jpg"]);
});

test("원본 배열을 건드리지 않는다", () => {
  const picked = [file("20260712_203058.mp4"), file("20260712_192901.mp4")];

  sortByCaptureTime(picked);

  assert.equal(picked[0].name, "20260712_203058.mp4");
});

test("올리기 전에 촬영 시각으로 정렬한다", () => {
  assert.match(script, /const files = sortByCaptureTime\(selected\);/);
});

test("순서 버튼은 그리드 방향에 맞춰 좌우를 쓴다", () => {
  // 4열 그리드에서 한 칸 앞은 위가 아니라 왼쪽이라 ↑↓ 가 헷갈렸다.
  assert.match(script, /data-detail-action="media-up"[^>]*>← 앞으로</);
  assert.match(script, /data-detail-action="media-down"[^>]*>뒤로 →</);
  assert.doesNotMatch(script, /data-detail-action="media-(up|down)"[^>]*>[↑↓]</);
});

test("순서 저장 안내가 막힌 로컬 경로를 가리키지 않는다", () => {
  // 로컬 생성은 #174 로 비활성이다.
  assert.doesNotMatch(script, /로컬에서 다시 생성·동기화/);
  assert.match(script, /순서를 저장했습니다\. 글을 다시 만들면 이 순서로 들어갑니다\./);
});

test("좁은 카드에서 버튼이 잘리지 않게 배치한다", () => {
  const css = read("assets/nblog-automation.css");

  assert.match(css, /\.nblog-media-item > div \{[^}]*grid-template-columns: 1fr 1fr/);
  assert.match(css, /\.nblog-media-item > div button\.is-danger \{[^}]*grid-column: 1 \/ -1/);
});
