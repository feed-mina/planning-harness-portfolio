import type { NBlogEnv } from "./nblog";
import { extractVideoFrames, knownLengthBody, type FrameSkip, type FrameSource } from "./nblogVideoFrames";

/** 모델에 넘기는 이미지 장수 상한 — detail:"low" 기준으로 토큰 비용을 통제합니다. */
export const MAX_VISION_IMAGES = 20;
/**
 * 요청이 끊기는 실제 원인은 장수가 아니라 **총 바이트**다.
 *
 * #171 로 프레임을 늘리자 18장 / 1,724KB 가 되어 `Network connection lost` 로 다시
 * 실패했다. 장수 상한(20)은 넘지 않았다 — 세는 단위가 틀렸다. 예산을 바이트로 잡고
 * 넘으면 거기서 멈춘다. 사진을 먼저 넣으므로 잘리는 쪽은 항상 뒤쪽 프레임이다.
 */
export const MAX_VISION_PAYLOAD_BYTES = 1_200 * 1024;
/** data URL 로 인라인할 수 있는 최대 크기. 초과하면 Images 바인딩으로 줄입니다. */
export const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
/**
 * `detail: "low"` 로 보내면 모델이 어차피 512×512 로 줄여서 봅니다. 768 로 보내던 것은
 * 바이트만 2배 쓰고 모델이 보는 화질은 같았습니다 — 모델이 보는 크기에 맞춥니다.
 */
const DOWNSCALE_WIDTH = 512;

export type VisionMedia = {
  media_id: string;
  type: "image" | "video";
  object_key: string;
  content_type: string | null;
  size: number;
  checksum: string;
  duration: number | null;
};

export type VisionImage = {
  media_id: string;
  source: "photo" | "frame";
  time_seconds?: number;
  data_url: string;
};

export type VisionSkip = FrameSkip | { media_id: string; reason: "too_large_no_images_binding" | "missing_object" | "photo_failed" | "vision_budget_reached"; detail?: string };

export type VisionInput = {
  images: VisionImage[];
  skipped: VisionSkip[];
  photo_count: number;
  frame_count: number;
};

async function streamToBase64(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await new Response(stream).text();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * 사진 한 장을 data URL 로 만듭니다.
 *
 * 크기와 무관하게 항상 축소합니다. 원본 화질이 필요한 작업이 아니라 "무엇이 찍혔는지"
 * 판별이 목적이라 폭 1536 이면 충분하고, 원본을 그대로 base64 로 실으면 요청이 커져
 * 모델 호출이 `Network connection lost` 로 끊깁니다(사진 1장일 땐 통과하다가 프레임이
 * 붙으면서 드러났습니다).
 */
async function photoDataUrl(env: NBlogEnv, item: VisionMedia): Promise<string | null> {
  const object = await env.R2.get(item.object_key);
  if (!object) return null;

  if (env.IMAGES) {
    const result = await env.IMAGES.input(await knownLengthBody(await object.arrayBuffer()))
      .transform({ width: DOWNSCALE_WIDTH })
      .output({ format: "image/jpeg", quality: 80 });
    return `data:image/jpeg;base64,${await streamToBase64(result.image({ encoding: "base64" }))}`;
  }

  // Images 바인딩이 없으면 축소할 방법이 없다. 큰 원본은 싣지 않고 제외한다.
  if (item.size > MAX_INLINE_IMAGE_BYTES) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return `data:${item.content_type || "image/jpeg"};base64,${bytesToBase64(bytes)}`;
}

async function frameDataUrl(env: NBlogEnv, objectKey: string): Promise<string | null> {
  const object = await env.R2.get(objectKey);
  if (!object) return null;
  return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await object.arrayBuffer()))}`;
}

function toFrameSource(item: VisionMedia): FrameSource {
  return {
    media_id: item.media_id,
    object_key: item.object_key,
    checksum: item.checksum,
    duration: item.duration,
    size: item.size,
  };
}

/**
 * 캠페인의 사진과 영상 프레임을 vision 입력으로 만듭니다 (#171).
 *
 * `media` 는 방문 순서(sort_order)대로 들어와야 합니다. 사진과 프레임을 그 순서
 * 그대로 섞어서 넘겨야 모델이 방문 흐름을 따라 글을 쓸 수 있습니다.
 */
export async function buildVisionImages(
  env: NBlogEnv,
  framePrefix: string,
  media: VisionMedia[],
): Promise<VisionInput> {
  const videos = media.filter((item) => item.type === "video");
  const extraction = await extractVideoFrames(env, framePrefix, videos.map(toFrameSource));
  const framesByMedia = new Map<string, typeof extraction.frames>();
  for (const frame of extraction.frames) {
    const bucket = framesByMedia.get(frame.media_id) || [];
    bucket.push(frame);
    framesByMedia.set(frame.media_id, bucket);
  }

  const images: VisionImage[] = [];
  const skipped: VisionSkip[] = [...extraction.skipped];
  let photoCount = 0;
  let frameCount = 0;
  let payloadBytes = 0;

  /** 예산을 넘지 않을 때만 담는다. 넘으면 담지 않고 false 를 돌려 호출부가 멈추게 한다. */
  const admit = (image: VisionImage): boolean => {
    if (images.length >= MAX_VISION_IMAGES) return false;
    if (payloadBytes + image.data_url.length > MAX_VISION_PAYLOAD_BYTES) return false;
    images.push(image);
    payloadBytes += image.data_url.length;
    return true;
  };

  // 사진을 먼저 담는다. 영수증처럼 메뉴명·가격이 그대로 보이는 근거라 프레임보다 값지고,
  // 예산이 모자랄 때 잘려야 할 쪽은 비슷한 장면이 여럿인 프레임이다.
  for (const item of media.filter((entry) => entry.type === "image")) {
    // 사진 한 장의 변환 실패가 캠페인 전체 생성을 죽이지 않도록 격리한다.
    // 프레임 추출은 이미 이렇게 처리하고 있었는데 사진 경로만 빠져 있었다.
    let dataUrl: string | null = null;
    try {
      dataUrl = await photoDataUrl(env, item);
    } catch (error) {
      skipped.push({ media_id: item.media_id, reason: "photo_failed", detail: String(error).slice(0, 180) });
      continue;
    }
    if (!dataUrl) {
      skipped.push({
        media_id: item.media_id,
        reason: item.size > MAX_INLINE_IMAGE_BYTES ? "too_large_no_images_binding" : "missing_object",
        detail: `${item.size} bytes`,
      });
      continue;
    }
    if (!admit({ media_id: item.media_id, source: "photo", data_url: dataUrl })) {
      skipped.push({ media_id: item.media_id, reason: "vision_budget_reached", detail: `${payloadBytes} bytes` });
      break;
    }
    photoCount += 1;
  }

  // 프레임은 영상별로 한 장씩 돌아가며 담는다. 앞 영상이 예산을 다 쓰고 뒤 영상이
  // 통째로 빠지는 것보다, 모든 영상이 최소 한 장씩 들어가는 편이 근거가 고르다.
  const videoOrder = media.filter((entry) => entry.type === "video");
  const deepest = Math.max(0, ...videoOrder.map((item) => (framesByMedia.get(item.media_id) || []).length));
  outer: for (let round = 0; round < deepest; round += 1) {
    for (const item of videoOrder) {
      const frame = (framesByMedia.get(item.media_id) || [])[round];
      if (!frame) continue;
      const dataUrl = await frameDataUrl(env, frame.object_key);
      if (!dataUrl) {
        skipped.push({ media_id: item.media_id, reason: "missing_object", detail: frame.object_key });
        continue;
      }
      if (!admit({ media_id: item.media_id, source: "frame", time_seconds: frame.time_seconds, data_url: dataUrl })) {
        skipped.push({ media_id: item.media_id, reason: "vision_budget_reached", detail: `${payloadBytes} bytes` });
        break outer;
      }
      frameCount += 1;
    }
  }

  return { images, skipped, photo_count: photoCount, frame_count: frameCount };
}
