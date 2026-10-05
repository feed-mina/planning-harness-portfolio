#!/usr/bin/env node
// 업무 실천 체크리스트의 단일 소스(checklist/checklist-items.json)에서 산출물 3개를 생성한다.
//
//   node scripts/build-checklist.mjs           산출물 갱신
//   node scripts/build-checklist.mjs --check    어긋나면 실패 (CI용)
//
// 항목이 여러 파일에 흩어져 있으면 한 곳만 고쳤을 때 조용히 어긋난다.
// SECTIONS 데이터 블록만 주입하고 렌더링·히스토리·편집 로직은 손대지 않는다.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = join(repoRoot, "checklist", "checklist-items.json");

const TARGETS = {
  appJs: join(repoRoot, "app", "public", "assets", "practice-checklist.js"),
  standaloneHtml: join(repoRoot, "checklist", "업무-실천-체크리스트.html"),
  markdown: join(repoRoot, "checklist", "업무-실천-체크리스트.md"),
};

const BEGIN = "// <checklist:sections> 생성됨 — checklist/checklist-items.json 을 고치고 npm run build:checklist";
const END = "// </checklist:sections>";

const jsString = (value) => JSON.stringify(value);

/** SECTIONS 배열 리터럴을 지정한 들여쓰기로 직렬화한다. */
function renderSections(sections, indent) {
  const pad = " ".repeat(indent);
  const body = sections.map((sec) => {
    const head = [`id: ${jsString(sec.id)}`, `icon: ${jsString(sec.icon)}`, `title: ${jsString(sec.title)}`];
    const groups = sec.groups.map((g) => {
      const parts = [];
      if (g.label) parts.push(`label: ${jsString(g.label)}`);
      if (g.neg) parts.push("neg: true");
      const items = g.items.map((t) => `${pad}      ${jsString(t)},`).join("\n");
      parts.push(`items: [\n${items}\n${pad}    ]`);
      return `${pad}    { ${parts.join(", ")} },`;
    }).join("\n");
    const tpl = sec.tpl
      ? `\n${pad}    tpl: { name: ${jsString(sec.tpl.name)}, text: ${jsString(sec.tpl.text)} },`
      : "";
    return `${pad}  {\n${pad}    ${head.join(", ")},${tpl}\n${pad}    groups: [\n${groups}\n${pad}    ],\n${pad}  },`;
  }).join("\n");
  return `${pad}const SECTIONS = [\n${body}\n${pad}];`;
}

/** 파일에서 마커 사이 블록만 교체한다. 마커가 없으면 명확히 실패시킨다. */
function replaceBlock(source, filePath, block, indent) {
  const pad = " ".repeat(indent);
  const beginLine = `${pad}${BEGIN}`;
  const endLine = `${pad}${END}`;
  const start = source.indexOf(beginLine);
  const stop = source.indexOf(endLine, start);
  if (start === -1 || stop === -1) {
    throw new Error(`${filePath}: <checklist:sections> 마커를 찾지 못했습니다. 마커를 지우지 마세요.`);
  }
  return source.slice(0, start) + beginLine + "\n" + block + "\n" + source.slice(stop);
}

function renderMarkdown(doc) {
  const lines = [
    "# 업무 실천 체크리스트",
    "",
    `> **${doc.principleLead}**${doc.principleRest}`,
    "",
    "같은 내용의 인터랙티브 버전: [업무-실천-체크리스트.html](./업무-실천-체크리스트.html)",
    "",
    "<!-- checklist/checklist-items.json 에서 생성됨 — 이 파일을 직접 고치지 마세요. -->",
    "",
    "---",
    "",
  ];
  doc.sections.forEach((sec) => {
    lines.push(`## ${sec.icon} ${sec.title}`, "");
    sec.groups.forEach((g) => {
      if (g.label) lines.push(`### ${g.label}`, "");
      g.items.forEach((t) => lines.push(`- [ ] ${t}`));
      lines.push("");
    });
    if (sec.tpl) {
      lines.push(`**${sec.tpl.name}**`, "", "```text", sec.tpl.text, "```", "");
    }
  });
  lines.push(
    "---",
    "",
    `## ⚠️ ${doc.boundary.title}`,
    "",
    "체크 항목이 아니라 경계선 리마인더다.",
    "",
    ...doc.boundary.items.map((t) => `- ${t}`),
    "",
    `> ${doc.boundary.note}`,
    "",
  );
  return lines.join("\n");
}

const doc = JSON.parse(readFileSync(SOURCE, "utf8"));
const check = process.argv.includes("--check");

const outputs = [
  [TARGETS.appJs, replaceBlock(readFileSync(TARGETS.appJs, "utf8"), TARGETS.appJs, renderSections(doc.sections, 2), 2)],
  [TARGETS.standaloneHtml, replaceBlock(readFileSync(TARGETS.standaloneHtml, "utf8"), TARGETS.standaloneHtml, renderSections(doc.sections, 0), 0)],
  [TARGETS.markdown, renderMarkdown(doc)],
];

const stale = outputs.filter(([path, next]) => readFileSync(path, "utf8") !== next).map(([path]) => path);

if (check) {
  if (stale.length) {
    console.error(
      "체크리스트 산출물이 단일 소스와 어긋났습니다:\n" +
      stale.map((p) => `  - ${p.replace(repoRoot + "/", "")}`).join("\n") +
      "\n\n`npm run build:checklist` 를 실행해 갱신하세요.",
    );
    process.exit(1);
  }
  const total = doc.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
  console.log(`체크리스트 산출물 3개가 단일 소스와 일치합니다 (${total}개 항목).`);
} else {
  outputs.forEach(([path, next]) => writeFileSync(path, next));
  const total = doc.sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
  console.log(`체크리스트 산출물 3개를 생성했습니다 (${total}개 항목).`);
  if (stale.length) stale.forEach((p) => console.log(`  갱신: ${p.replace(repoRoot + "/", "")}`));
}
