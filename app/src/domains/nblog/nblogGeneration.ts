import type { NBlogActor, NBlogEnv, NBlogWorkflowParams } from "./nblog";
import { isPlaceholderPlaceUrl, NBLOG_CONTRACT_VERSION, NBlogError, renderPromptTemplate, resolvePromptTemplate, stableStringify } from "./nblog";
import { buildVisionImages, type VisionMedia } from "./nblogVisionInput";
import { listVoiceNotes, voiceNotesForPrompt } from "./nblogVoiceNotes";

type Campaign = Record<string, unknown> & {
  user_id: string; campaign_id: string; campaign_name: string; visit_date: string;
  visit_notes: string; requirements: string; place_url: string; campaign_url: string; category: string | null;
  tone_profile: string; user_tags_json: string; prompt_override: string | null;
  prompt_profile_id: string | null; generation_input_hash: string | null; version: number;
};

/** 체험단 후기는 대가성 표기가 법적으로 필수라 캠페인이 따로 지정하지 않아도 항상 넣는다. */
const SPONSOR_DISCLOSURE = "이 글은 업체로부터 서비스를 제공받아 솔직하게 작성한 후기입니다.";

/**
 * 협찬 고지와 결제 금액을 함께 노출하지 않는다 (#191). 프롬프트로 막지만 새어나갈 수
 * 있어 후처리로 확인한다. 천 단위 구분자가 있는 수 또는 '원'이 붙은 수를 금액으로 본다.
 */
export function findCurrencyAmounts(markdown: string): string[] {
  const withSeparator = markdown.match(/\d{1,3}(?:,\d{3})+(?:\s*원)?/g) || [];
  const withUnit = markdown.match(/\d{3,}\s*원/g) || [];
  // 뒤에 붙은 공백을 떼야 같은 금액이 중복으로 보고되지 않는다.
  return [...new Set([...withSeparator, ...withUnit].map((value) => value.trim()))];
}

export type DraftCheck = { rule: string; status: string; message: string };

/**
 * 초안 후처리 검증 (#173).
 *
 * 검증 대상은 **검증 가능한 사실과 발행 규격**이지 문체가 아니다. 감상·분위기 표현은
 * 사람이 확인 후 발행하므로 막지 않는다(#189). 반면 협찬 표기 누락이나 사진 표시
 * 개수가 어긋난 것은 사람이 눈으로 세기 어렵다.
 */
export function checkDraftQuality(
  markdown: string,
  context: { mediaCount: number; requirements: string; sponsorDisclosure: string },
): DraftCheck[] {
  const checks: DraftCheck[] = [];

  if (!markdown.includes(context.sponsorDisclosure)) {
    checks.push({ rule: "sponsor_disclosure_missing", status: "failed", message: "협찬 표기가 본문에 없습니다. 체험단 후기는 대가성 표기가 법적으로 필수입니다." });
  }

  /*
    표시는 **올린 파일 수**와 맞아야 한다. 프레임 수와 비교하던 탓에 영상 6개 캠페인이
    [VIDEO:002]~[VIDEO:011] 로 나와도 통과했다 — 넣을 파일은 7개인데 자리는 11개였다.
  */
  const markers = new Set(markdown.match(/\[(?:IMAGE|VIDEO):\d{3}\]/g) || []);
  const numbers = [...markers].map((marker) => Number(/\d{3}/.exec(marker)![0]));
  const invented = numbers.filter((number) => number < 1 || number > context.mediaCount);
  if (invented.length) {
    checks.push({
      rule: "media_marker_out_of_range", status: "failed",
      message: `올린 파일은 ${context.mediaCount}개인데 본문에 없는 번호(${invented.sort((a, b) => a - b).join(", ")})를 가리키는 표시가 있습니다. 그 줄은 지우고 발행하세요.`,
    });
  }
  if (markers.size < context.mediaCount) {
    checks.push({
      rule: "image_marker_missing", status: "warning",
      message: `사진·영상 표시가 ${markers.size}개로 올린 ${context.mediaCount}개보다 적습니다. 빠진 자리는 직접 넣어주세요.`,
    });
  }

  const tagLine = markdown.split("\n").reverse().find((line) => line.trim().startsWith("#") && !line.trim().startsWith("##"));
  const tagCount = (tagLine?.match(/#[^\s#]+/g) || []).length;
  if (tagCount < 10) {
    checks.push({ rule: "tag_count_low", status: "warning", message: `해시태그가 ${tagCount}개입니다. 10개 이상을 권장합니다.` });
  }

  if (!/^##\s/m.test(markdown)) {
    checks.push({ rule: "heading_missing", status: "warning", message: "소제목이 없습니다. 네이버 블로그는 소제목이 있는 편이 읽기 좋습니다." });
  }

  /*
    큰 제목(#)은 글 제목 하나뿐이어야 한다. staging v9 는 '# 한줄평', '# 해시태그',
    '# 미생맥주 방문 정리' 를 큰 제목으로 달았다 — 폐지하려던 고정 섹션이 형태만 바꿔
    돌아온 것이고(#172), '해시태그' 라는 제목은 블로그에 그대로 노출되면 어색하다.
    태그 줄('#미생맥주 …')은 # 뒤에 공백이 없어 제목과 구분된다.
  */
  const bigHeadings = markdown.split("\n").filter((line) => /^#\s+\S/.test(line.trim()));
  if (bigHeadings.length > 1) {
    checks.push({
      rule: "extra_h1_heading", status: "warning",
      message: `큰 제목이 ${bigHeadings.length}개입니다(${bigHeadings.slice(1).map((line) => line.replace(/^#\s+/, "").trim()).join(", ")}). 글 제목만 큰 제목으로 두고 나머지는 소제목(##)으로 바꾸거나 지워주세요.`,
    });
  }

  // 네이버 플레이스·지도 링크는 스마트에디터에서 장소 카드로 안 바뀌어 텍스트 링크로만
  // 남는다. 장소는 발행 화면의 '장소 넣기' 단계에서 넣으므로 본문에 있으면 안 된다.
  if (/https?:\/\/(?:naver\.me|(?:m\.)?(?:map|place)\.naver\.com)\/\S+/.test(markdown)) {
    checks.push({
      rule: "place_link_in_body", status: "warning",
      message: "본문에 네이버 지도·플레이스 링크가 있습니다. 그 줄은 지우고, 장소는 발행할 때 장소 버튼으로 넣어주세요.",
    });
  }

  // 캠페인 요구사항에 적힌 필수 키워드가 본문에 들어갔는지 — 등록된 사실이라 확인 가능하다.
  for (const [, keyword, countText] of context.requirements.matchAll(/([가-힣A-Za-z0-9]+)\s*(\d+)\s*회/g)) {
    const needed = Number(countText);
    const actual = markdown.split(keyword).length - 1;
    if (actual < needed) {
      checks.push({
        rule: "required_keyword_short", status: "warning",
        message: `요구사항의 '${keyword}'가 ${actual}회로 필요한 ${needed}회보다 적습니다.`,
      });
    }
  }

  const bodyChars = markdown.replace(/\s/g, "").length;
  if (bodyChars < 1_000) {
    checks.push({ rule: "body_length_short", status: "warning", message: `본문이 공백 제외 ${bodyChars}자입니다. 1,000자를 권장합니다.` });
  }

  return checks;
}
type Media = { media_id: string; type: "image" | "video"; original_name: string; object_key: string; content_type: string | null; size: number; sort_order: number; checksum: string; duration: number | null };

const nowIso = () => new Date().toISOString();
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeId(value: string): string { return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 50); }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!)); }
function extractText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text.trim();
  return (Array.isArray(data.output) ? data.output : []).flatMap((item) =>
    item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content)
      ? (item as { content: Array<Record<string, unknown>> }).content : [])
    .map((part) => typeof part.text === "string" ? part.text : "").join("").trim();
}
function parseDraft(raw: string): { title: string; markdown: string; image_summaries: string[] } {
  const value = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()) as Record<string, unknown>;
  const title = typeof value.title === "string" ? value.title.trim().slice(0, 200) : "";
  const forbidden = /(?:확인\s*필요|사용자\s*확인|미확인\s*항목)/i;
  const markdown = (typeof value.markdown === "string" ? value.markdown : "").split("\n")
    .filter((line) => !forbidden.test(line)).join("\n").trim();
  if (!title || !markdown) throw new Error("generated draft is empty");
  const imageSummaries = Array.isArray(value.image_summaries)
    ? value.image_summaries.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
  return { title, markdown, image_summaries: imageSummaries };
}

async function campaign(env: NBlogEnv, userId: string, campaignId: string): Promise<Campaign> {
  const row = await env.DB.prepare("SELECT * FROM nblog_campaigns WHERE user_id=?1 AND campaign_id=?2").bind(userId, campaignId).first<Campaign>();
  if (!row) throw new NBlogError(404, "campaign_not_found", "캠페인을 찾을 수 없습니다.");
  return row;
}
async function readyMedia(env: NBlogEnv, userId: string, campaignId: string): Promise<Media[]> {
  const result = await env.DB.prepare(
    `SELECT media_id,type,original_name,object_key,content_type,size,sort_order,checksum,duration FROM nblog_media_assets
     WHERE user_id=?1 AND campaign_id=?2 AND included=1 AND status='ready' ORDER BY sort_order,media_id`
  ).bind(userId, campaignId).all<Media>();
  return result.results || [];
}

export async function startNBlogGeneration(env: NBlogEnv, actor: NBlogActor, campaignId: string) {
  if (!env.NBLOG_WORKFLOW) throw new NBlogError(503, "workflow_unconfigured", "자동 글 생성 Worker가 아직 연결되지 않았습니다.", { retryable: true });
  const row = await campaign(env, actor.userId, campaignId);
  const all = await env.DB.prepare("SELECT media_id,checksum,sort_order,status,included FROM nblog_media_assets WHERE user_id=?1 AND campaign_id=?2 ORDER BY sort_order,media_id")
    .bind(actor.userId, campaignId).all<Record<string, unknown>>();
  const included = (all.results || []).filter((item) => item.included === 1);
  if (!included.length || included.some((item) => item.status !== "ready")) throw new NBlogError(409, "media_not_ready", "사진·영상 업로드가 모두 끝난 뒤 글을 생성할 수 있습니다.");
  const voices = await env.DB.prepare("SELECT note_id,transcript,transcript_status FROM nblog_voice_notes WHERE user_id=?1 AND campaign_id=?2 ORDER BY note_id")
    .bind(actor.userId, campaignId).all<Record<string, unknown>>();
  // 음성메모를 고치면 해시가 바뀌어 재생성이 열린다 (#186).
  const inputHash = `sha256:${await sha256(stableStringify({ campaign_id: campaignId, visit_date: row.visit_date, prompt: row.prompt_profile_id, media: included, voices: voices.results || [] }))}`;
  const existing = await env.DB.prepare("SELECT id,workflow_id,status FROM nblog_generation_runs WHERE user_id=?1 AND campaign_id=?2 AND input_hash=?3")
    .bind(actor.userId, campaignId, inputHash).first<{ id: string; workflow_id: string | null; status: string }>();
  // 재사용은 "진행 중" 실행에만 적용한다 — 중복 실행을 막는 것이 이 가드의 목적이다.
  // 사진이 그대로면 input_hash 도 같으므로, completed/failed 까지 재사용하면 사용자가
  // '다시 만들기'를 눌러도 아무 일이 일어나지 않는다(생성 로직을 고친 뒤 재생성 불가).
  if (existing && existing.status === "generating") {
    return { run_id: existing.id, workflow_id: existing.workflow_id, status: existing.status, reused: true };
  }
  // UNIQUE(user_id,campaign_id,input_hash) 때문에 새 행을 넣을 수 없어 기존 행을 되살린다.
  const runId = existing?.id || crypto.randomUUID();
  // 워크플로 인스턴스는 종료된 것을 같은 id 로 다시 만들 수 없어 재시도마다 접미사를 붙인다.
  const retrySuffix = existing ? `-r${Date.now().toString(36).slice(-6)}` : "";
  const workflowId = `${safeId(campaignId)}-generate-${inputHash.slice(-12)}${retrySuffix}`;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO nblog_generation_runs (id,user_id,campaign_id,input_hash,workflow_id,status,created_by,created_at)
       VALUES (?1,?2,?3,?4,?5,'generating',?6,?7)
       ON CONFLICT(user_id,campaign_id,input_hash) DO UPDATE SET
         workflow_id=excluded.workflow_id, status='generating',
         error_code=NULL, error_message=NULL, completed_at=NULL,
         created_by=excluded.created_by, created_at=excluded.created_at`)
      .bind(runId, actor.userId, campaignId, inputHash, workflowId, actor.label, now),
    env.DB.prepare("UPDATE nblog_campaigns SET status='analysis',operation_status='syncing',generation_status='generating',generation_input_hash=?1,workflow_instance_id=?2,failure_stage=NULL,failure_reason=NULL,version=version+1,updated_at=?3 WHERE user_id=?4 AND campaign_id=?5")
      .bind(inputHash, workflowId, now, actor.userId, campaignId),
  ]);
  try {
    await env.NBLOG_WORKFLOW.create({ id: workflowId, params: { user_id: actor.userId, campaign_id: campaignId, requested_by: actor.label, reason: "generate", generation_run_id: runId, input_hash: inputHash } });
  } catch (error) {
    await markGenerationFailed(env, { user_id: actor.userId, campaign_id: campaignId, requested_by: actor.label, reason: "generate", generation_run_id: runId, input_hash: inputHash }, error);
    throw new NBlogError(502, "workflow_start_failed", "자동 글 생성 작업을 시작하지 못했습니다.", { retryable: true });
  }
  return { run_id: runId, workflow_id: workflowId, status: "generating", reused: false };
}

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

function toVisionMedia(item: Media): VisionMedia {
  return {
    media_id: item.media_id, type: item.type, object_key: item.object_key,
    content_type: item.content_type, size: item.size, checksum: item.checksum, duration: item.duration,
  };
}

export async function runNBlogWorkerGeneration(env: NBlogEnv, params: NBlogWorkflowParams): Promise<{ status: string; artifact_version: number }> {
  if (!params.generation_run_id || !params.input_hash) throw new Error("generation params are missing");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const row = await campaign(env, params.user_id, params.campaign_id);
  if (row.generation_input_hash !== params.input_hash) throw new Error("generation input changed");
  const media = await readyMedia(env, params.user_id, params.campaign_id);
  const prefix = (await sha256(params.user_id)).slice(0, 16);
  const vision = await buildVisionImages(env, `nblog-frames/${prefix}/${safeId(params.campaign_id)}`, media.map(toVisionMedia));
  // 프레임 추출 결과는 성공 시 media_analysis 산출물에만 남는다. 이후 단계(OpenAI 등)에서
  // 실패하면 산출물이 아예 안 써져 근거 수집이 통째로 사라지므로 여기서 먼저 남긴다.
  console.log(JSON.stringify({
    event: "nblog_vision_input", campaign_id: params.campaign_id,
    media_binding: Boolean(env.MEDIA), images_binding: Boolean(env.IMAGES),
    media_total: media.length, videos: media.filter((item) => item.type === "video").length,
    vision_images: vision.images.length, photos: vision.photo_count, frames: vision.frame_count,
    // 요청이 커지면 모델 호출이 `Network connection lost` 로 끊긴다. 크기를 남겨 판별한다.
    payload_kb: Math.round(vision.images.reduce((sum, image) => sum + image.data_url.length, 0) / 1024),
    skipped: vision.skipped,
  }));
  // 표시는 **올린 파일 하나당 하나**다. 프레임 단위로 만들었더니 영상 6개짜리 캠페인에
  // [VIDEO:002]~[VIDEO:011] 이 나왔다 — 사용자가 스마트에디터에서 넣을 파일은 7개인데
  // 자리는 11개라 맞출 수가 없다. 프레임은 그 영상을 묘사할 근거일 뿐 삽입 지점이 아니다.
  const framesByMedia = new Map<string, string[]>();
  for (const image of vision.images) {
    if (image.source !== "frame") continue;
    const scenes = framesByMedia.get(image.media_id) || [];
    scenes.push(`${image.time_seconds}초`);
    framesByMedia.set(image.media_id, scenes);
  }
  const placeholders = media.map((item, index) => {
    const label = `[${item.type === "video" ? "VIDEO" : "IMAGE"}:${String(index + 1).padStart(3, "0")}]`;
    const scenes = framesByMedia.get(item.media_id);
    return scenes?.length ? `${label} (영상 1개 — ${scenes.join(", ")} 장면을 함께 보여준 것)` : label;
  }).join("\n");
  const userTags = (parseTags(row.user_tags_json)).join(", ") || "없음";
  // 사용자가 직접 말한 내용은 사진에 없는 맛·서비스·감상의 근거가 된다 (#186).
  const voiceEvidence = voiceNotesForPrompt(await listVoiceNotes(env, params.user_id, params.campaign_id));
  // 입력 검증(#190) 이전에 등록된 캠페인은 지도 홈 주소가 들어 있다. 잘못된 링크를
  // 본문에 넣느니 링크 줄을 아예 만들지 않는 편이 낫다.
  const placeUrlUsable = Boolean(row.place_url) && !isPlaceholderPlaceUrl(row.place_url);

  // 사용자가 편집한 '글 작성 규칙'이 실제 생성에 반영된다 (#188).
  const { template, source: promptSource } = await resolvePromptTemplate(env, params.user_id, row);
  const rendered = renderPromptTemplate(template, {
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    campaign_url: String(row.campaign_url || ""),
    visit_date: row.visit_date,
    category: row.category || "미지정",
    place_url: placeUrlUsable ? row.place_url : "없음",
    tone_profile: row.tone_profile || "자연스러운 일기·브이로그체",
    user_tags: userTags,
    visit_notes: row.visit_notes || "없음",
    voice_notes: voiceEvidence || "없음",
    requirements: row.requirements || "없음",
    media_manifest: `사진 ${vision.photo_count}장, 영상 ${media.filter((item) => item.type === "video").length}개`,
    image_summaries: `사진 ${vision.photo_count}장 (방문 순서대로 정렬)`,
    video_summaries: `${vision.frame_count}장`,
    sponsor_disclosure: SPONSOR_DISCLOSURE,
    map_or_place_block: placeUrlUsable ? row.place_url : "",
    unconfirmed_items: "없음",
  });

  // 편집으로 깨지면 안 되는 규칙은 코드에 남긴다 — 출력 형식, 사진 표시, 협찬 표기,
  // 금액 금지, 링크 환각 차단.
  const enforced = [
    "",
    `사용자가 올린 파일은 아래 ${media.length}개가 전부입니다. 본문의 해당 장면을 설명한 문단 바로 뒤에 이 표시를 그대로 한 줄로 넣으세요:`,
    placeholders,
    `표시는 위 목록에 있는 것만, 각각 딱 한 번씩만 쓰세요. ${String(media.length + 1).padStart(3, "0")} 이상의 번호는 없습니다. 영상 한 개의 여러 장면을 봤더라도 그 영상의 표시는 하나뿐입니다.`,
    "",
    "반드시 지킬 것:",
    `1. 맨 첫 줄(제목 다음)에 이 문구를 그대로 넣으세요: "${SPONSOR_DISCLOSURE}"`,
    "2. 메뉴판·간판·영수증에 적힌 글자는 읽어서 메뉴명을 쓰세요. 다만 금액은 쓰지 마세요 — 가격, 합계, 결제 금액, 영수증 발행 시각은 본문에 넣지 않습니다. 협찬 후기라 결제 내역 노출이 적절하지 않습니다. 영수증·계산서가 찍힌 사진은 이미지 표시도 본문에 넣지 마세요.",
    // 날링크(https://naver.me/...)는 스마트에디터에서 장소 카드로 안 바뀐다. 본문에
    // 넣으면 텍스트 링크로만 남아 지저분하다. 장소는 발행 화면의 '장소 넣기' 단계에서
    // 장소 버튼으로 넣으므로, 본문에는 링크도 주소도 넣지 않는다.
    "3. 네이버 플레이스 링크나 지도 URL(naver.me, map.naver.com 등)을 본문에 절대 넣지 마세요. 장소는 발행할 때 따로 넣습니다. 가게 이름과 도로명·지번 주소는 문장 안에 자연스럽게 언급해도 됩니다.",
    "4. 맨 마지막 줄에 해시태그만 한 줄로 넣으세요. 예시 형식: #미생맥주 #수원술집 #체험단후기. 그 위에 '# 해시태그' 나 '해시태그' 같은 제목 줄을 절대 넣지 마세요 — 태그 줄만 있으면 됩니다. 10~20개를 사용자 지정 태그부터 채우되, 확인되지 않은 지역명은 쓰지 마세요.",
    "5. '확인 필요', '사용자 확인', '미확인 항목'을 본문에 쓰지 마세요.",
    "6. 큰 제목(#)은 맨 위 글 제목 하나뿐입니다. 나머지 소제목은 ##를 쓰세요. '한줄평', '방문 정리', '해시태그', '기본 정보' 같은 고정 섹션 제목은 넣지 마세요 — 겪은 순서대로 이어지는 글이어야 합니다.",
    ...(voiceEvidence
      ? ["7. 위 음성메모는 방문자가 직접 말한 내용이라 근거로 씁니다. 거기 언급된 맛·서비스·대기시간·동행 반응은 본문에 반영하세요. 다만 음성메모에 없는 것까지 넓히지는 마세요."]
      : []),
    "",
    'JSON만 출력하세요: {"title":"...","markdown":"# 제목\\n\\n본문...","image_summaries":["사진 1 ..."]}',
  ].join("\n");

  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: `${rendered}\n${enforced}` }];
  for (const image of vision.images) content.push({ type: "input_image", detail: "low", image_url: image.data_url });
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: env.NBLOG_GENERATION_MODEL || "gpt-5-mini", input: [{ role: "user", content }] }) });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const draft = parseDraft(extractText(await response.json() as Record<string, unknown>));
  const amounts = findCurrencyAmounts(draft.markdown);
  // 사진 장수가 아니라 모델이 실제로 본 이미지 수를 기준으로 판단합니다 — 영상 프레임도 근거이기 때문입니다.
  const checks = [
    ...(vision.images.length < 15 ? [{ rule: "minimum_image_count", status: "warning", message: `권장 근거 이미지는 15장이지만 현재 ${vision.images.length}장(사진 ${vision.photo_count}, 영상 장면 ${vision.frame_count})으로 글 확인이 가능합니다.` }] : []),
    // 플레이스 링크는 체험단 성과 지표라 빠지면 사용자가 알아야 한다 (#190).
    ...(placeUrlUsable ? [] : [{ rule: "place_url_missing", status: "warning", message: "플레이스 링크가 특정 장소를 가리키지 않아 본문에서 제외했습니다. 캠페인의 플레이스 링크를 실제 주소로 고쳐주세요." }]),
    // 협찬 고지와 결제 금액이 함께 나가면 안 된다 (#191).
    ...(amounts.length ? [{ rule: "currency_amount_exposed", status: "warning", message: `협찬 후기에 결제 금액으로 보이는 표현이 있습니다: ${amounts.slice(0, 5).join(", ")}. 발행 전 삭제해주세요.` }] : []),
    // 발행 규격 확인 — 협찬 표기·사진 표시·태그·소제목·필수 키워드·분량 (#173)
    ...checkDraftQuality(draft.markdown, {
      // 근거 이미지 수가 아니라 사용자가 스마트에디터에 넣을 파일 수로 센다.
      mediaCount: media.length,
      requirements: row.requirements || "",
      sponsorDisclosure: SPONSOR_DISCLOSURE,
    }),
  ];
  const artifacts = {
    manifest: { campaign_id: row.campaign_id, media: media.map((item) => ({ media_id: item.media_id, type: item.type, order: item.sort_order, original_name: item.original_name })) },
    media_analysis: { campaign_id: row.campaign_id, image_summaries: draft.image_summaries, analyzed_images: vision.images.length, photo_count: vision.photo_count, frame_count: vision.frame_count, video_count: media.filter((item) => item.type === "video").length, skipped: vision.skipped },
    requirements: { campaign_id: row.campaign_id, snapshot_hash: params.input_hash, minimum_images: 15 },
    draft: { campaign_id: row.campaign_id, draft_version: params.input_hash, title: draft.title, markdown: draft.markdown, prompt: { profile_version: row.prompt_profile_id || "system-default", source: promptSource, rendered_hash: params.input_hash } },
    draft_markdown: draft.markdown,
    validation: { campaign_id: row.campaign_id, status: "passed", outcome: checks.length ? "review_required" : "passed_automatically", approval_allowed: true, confirmation_allowed: true, validator_version: "worker-v1", input_hash: params.input_hash, checks },
    preview_html: `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${escapeHtml(draft.title)}</title><body><pre style="white-space:pre-wrap;font:16px/1.7 sans-serif">${escapeHtml(draft.markdown)}</pre></body></html>`,
  };
  const contentHash = `sha256:${await sha256(stableStringify(artifacts))}`;
  const previous = await env.DB.prepare("SELECT COALESCE(MAX(artifact_version),0) AS version FROM nblog_artifact_versions WHERE user_id=?1 AND campaign_id=?2").bind(params.user_id, params.campaign_id).first<{ version: number }>();
  const artifactVersion = Number(previous?.version || 0) + 1;
  const base = `nblog/${prefix}/${safeId(params.campaign_id)}/v${artifactVersion}`;
  const keys: Record<string, string> = {};
  const files: Record<string, [string, unknown, string]> = {
    manifest: ["manifest.json", artifacts.manifest, "application/json"], media_analysis: ["media-analysis.json", artifacts.media_analysis, "application/json"],
    requirements: ["requirements.json", artifacts.requirements, "application/json"], draft: ["draft.json", artifacts.draft, "application/json"],
    draft_markdown: ["draft.md", artifacts.draft_markdown, "text/markdown; charset=utf-8"], validation: ["validation.json", artifacts.validation, "application/json"], preview_html: ["preview.html", artifacts.preview_html, "text/html; charset=utf-8"],
  };
  for (const [name, [file, value, type]] of Object.entries(files)) {
    const key = `${base}/${file}`; keys[name] = key;
    await env.R2.put(key, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { httpMetadata: { contentType: type }, customMetadata: { campaign_id: params.campaign_id, artifact_version: String(artifactVersion), content_hash: contentHash } });
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO nblog_artifact_versions (user_id,campaign_id,artifact_version,schema_version,content_hash,idempotency_key,object_keys_json,requirement_version,draft_version,validation_version,profile_version,validation_passed,created_at,created_by) VALUES (?1,?2,?3,'1.1',?4,?5,?6,?7,?7,'worker-v1',?8,1,?9,?10)`)
      .bind(params.user_id, params.campaign_id, artifactVersion, contentHash, `${params.campaign_id}:${row.visit_date}`, JSON.stringify(keys), params.input_hash, row.prompt_profile_id || "system-default", now, params.requested_by),
    env.DB.prepare(`UPDATE nblog_campaigns SET status='approval',operation_status='approval_waiting',generation_status='awaiting_content_review',validation_passed=1,artifact_version=?1,artifact_content_hash=?2,requirement_version=?3,draft_version=?3,validation_version='worker-v1',profile_version=?4,last_sync_at=?5,updated_at=?5,version=version+1 WHERE user_id=?6 AND campaign_id=?7 AND generation_input_hash=?3`)
      .bind(artifactVersion, contentHash, params.input_hash, row.prompt_profile_id || "system-default", now, params.user_id, params.campaign_id),
    env.DB.prepare("UPDATE nblog_generation_runs SET status='completed',completed_at=?1 WHERE id=?2").bind(now, params.generation_run_id),
  ]);
  return { status: "awaiting_content_review", artifact_version: artifactVersion };
}

export async function markGenerationFailed(env: NBlogEnv, params: NBlogWorkflowParams, error: unknown): Promise<void> {
  const now = nowIso(); const message = String(error).slice(0, 800);
  await env.DB.batch([
    env.DB.prepare("UPDATE nblog_generation_runs SET status='failed',error_code='generation_failed',error_message=?1,completed_at=?2 WHERE id=?3").bind(message, now, params.generation_run_id || ""),
    env.DB.prepare("UPDATE nblog_campaigns SET status='failed',operation_status='failed',generation_status='generation_failed',failure_stage='generation',failure_reason=?1,updated_at=?2 WHERE user_id=?3 AND campaign_id=?4").bind(message, now, params.user_id, params.campaign_id),
  ]);
}

export async function confirmNBlogContent(env: NBlogEnv, actor: NBlogActor, campaignId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const row = await campaign(env, actor.userId, campaignId);
  if (row.generation_status !== "awaiting_content_review") throw new NBlogError(409, "content_review_not_ready", "확인할 최신 글이 없습니다.");
  if (body.confirmed !== true) throw new NBlogError(400, "confirmation_required", "글 확인 동의가 필요합니다.");
  const expected = Number(body.expected_artifact_version);
  const actual = Number(row.artifact_version || 0);
  if (!Number.isSafeInteger(expected) || expected !== actual) throw new NBlogError(409, "artifact_version_conflict", "글이 변경되었습니다. 최신 글을 다시 확인해주세요.", { expected: actual });
  const inputHash = String(row.generation_input_hash || ""); const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO nblog_content_confirmations (id,user_id,campaign_id,artifact_version,input_hash,confirmed_by,confirmed_at,confirmation_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
      .bind(crypto.randomUUID(), actor.userId, campaignId, actual, inputHash, actor.label, now, JSON.stringify({ confirmed: true })),
    env.DB.prepare("UPDATE nblog_campaigns SET status='scheduled',operation_status='approved_for_handoff',generation_status='content_confirmed',approved_at=?1,approved_by=?2,content_confirmed_at=?1,content_confirmed_by=?2,content_confirmed_artifact_version=?3,updated_at=?1,version=version+1 WHERE user_id=?4 AND campaign_id=?5 AND artifact_version=?3")
      .bind(now, actor.label, actual, actor.userId, campaignId),
  ]);
  return { campaign_id: campaignId, generation_status: "content_confirmed", operation_status: "approved_for_handoff", artifact_version: actual, content_confirmed_at: now, contract_version: NBLOG_CONTRACT_VERSION };
}
