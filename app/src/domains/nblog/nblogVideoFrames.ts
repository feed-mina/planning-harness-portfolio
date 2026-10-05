import type { NBlogEnv } from "./nblog";

// Media Transformations 자체 입력 상한은 100MB 지만(https://developers.cloudflare.com/stream/transform-videos/),
// 바인딩에 넘길 "길이가 알려진 스트림"을 만들려면 전체를 버퍼링해야 해서 Worker 메모리
// (128MB)를 고려해 더 낮게 잡습니다. 초과분은 호출하지 않고 건너뜁니다.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 600;
const DEFAULT_MAX_FRAMES_PER_CAMPAIGN = 24;
// 사진과 같은 이유로 작게 뽑습니다 — detail:"low" 는 512×512 로 축소해서 봅니다.
const FRAME_WIDTH = 768;

export type FrameSource = {
  media_id: string;
  object_key: string;
  checksum: string;
  duration: number | null;
  size: number;
};

export type VideoFrame = {
  media_id: string;
  frame_index: number;
  time_seconds: number;
  object_key: string;
  cached: boolean;
};

export type FrameSkip = {
  media_id: string;
  reason: "too_large" | "too_long" | "missing_object" | "extraction_failed" | "frame_cap_reached";
  detail?: string;
};

export type FrameExtraction = { frames: VideoFrame[]; skipped: FrameSkip[] };

/**
 * 영상 길이에 맞춰 추출할 프레임 수를 정합니다. 짧은 영상에서 거의 같은 장면을
 * 여러 장 뽑아 변환 비용만 쓰는 것을 막습니다.
 */
export function frameCountFor(duration: number | null): number {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 1;
  if (duration < 3) return 1;
  if (duration < 8) return 2;
  return 3;
}

/**
 * duration 을 모를 때 시도할 지점. 길이 저장(#171) 이전에 올라온 영상이 여기 해당한다.
 * 영상보다 뒤 시점은 변환이 실패하지만 프레임 단위로 격리되어 나머지는 계속 뽑힌다 —
 * 실패 호출 몇 번을 감수하고 근거를 3배로 늘리는 편이 낫다.
 */
const UNKNOWN_DURATION_TIMESTAMPS = [0, 2, 5];

/**
 * 첫 프레임(암전)과 마지막 프레임(흔들림)을 피해 구간을 균등 분할합니다.
 */
export function frameTimestamps(duration: number | null): number[] {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return [...UNKNOWN_DURATION_TIMESTAMPS];
  const count = frameCountFor(duration);
  const result: number[] = [];
  for (let index = 1; index <= count; index += 1) {
    result.push(Number(((duration * index) / (count + 1)).toFixed(3)));
  }
  return result;
}

export function maxFramesPerCampaign(env: NBlogEnv): number {
  const parsed = Number(env.NBLOG_MAX_VIDEO_FRAMES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FRAMES_PER_CAMPAIGN;
}

/** checksum 을 키에 포함해 같은 media_id 로 다시 업로드하면 캐시가 자연히 무효화됩니다. */
export function frameObjectKey(basePrefix: string, source: FrameSource, timeSeconds: number): string {
  return `${basePrefix}/${source.media_id}/${source.checksum.slice(0, 16)}-t${String(timeSeconds).replace(".", "_")}.jpg`;
}

/**
 * Media/Images 바인딩은 **길이가 알려진** 스트림만 받습니다. R2 객체의 body 를 그대로
 * 넘기면 `Provided readable stream must have a known length` 로 전부 실패합니다.
 *
 * FixedLengthStream 으로 감싸는 방법은 staging 에서 통하지 않았습니다 — 이 바인딩은 RPC
 * 라서 스트림이 경계를 넘으며 길이 정보가 사라집니다. 확실한 경로는 Response 본문이라
 * 전체를 버퍼링합니다. 그래서 MAX_VIDEO_BYTES 를 API 상한보다 낮게 잡습니다.
 */
export async function knownLengthBody(bytes: ArrayBuffer): Promise<ReadableStream<Uint8Array>> {
  return new Response(bytes).body!;
}

function skipReasonFor(source: FrameSource): FrameSkip["reason"] | null {
  if (source.size > MAX_VIDEO_BYTES) return "too_large";
  if (source.duration !== null && Number.isFinite(source.duration) && source.duration > MAX_VIDEO_SECONDS) return "too_long";
  return null;
}

/**
 * 영상에서 대표 프레임을 뽑아 R2 에 캐시합니다 (#170).
 *
 * 한 영상의 실패가 캠페인 전체 생성을 막지 않도록 프레임 단위로 격리합니다.
 * R2 body 스트림은 한 번만 소비할 수 있어 프레임마다 객체를 다시 가져옵니다.
 */
export async function extractVideoFrames(
  env: NBlogEnv,
  basePrefix: string,
  sources: FrameSource[],
): Promise<FrameExtraction> {
  const frames: VideoFrame[] = [];
  const skipped: FrameSkip[] = [];
  if (!env.MEDIA) return { frames, skipped };

  const cap = maxFramesPerCampaign(env);

  for (const source of sources) {
    const limitReason = skipReasonFor(source);
    if (limitReason) {
      skipped.push({
        media_id: source.media_id,
        reason: limitReason,
        detail: limitReason === "too_large" ? `${source.size} bytes` : `${source.duration}s`,
      });
      continue;
    }

    for (const [index, timeSeconds] of frameTimestamps(source.duration).entries()) {
      if (frames.length >= cap) {
        skipped.push({ media_id: source.media_id, reason: "frame_cap_reached", detail: `cap=${cap}` });
        return { frames, skipped };
      }

      const key = frameObjectKey(basePrefix, source, timeSeconds);
      const cachedHead = await env.R2.head(key);
      if (cachedHead) {
        frames.push({ media_id: source.media_id, frame_index: index, time_seconds: timeSeconds, object_key: key, cached: true });
        continue;
      }

      // 입력(MEDIA.input)과 출력(R2.put)이 "must have a known length" 라는 **같은 문구**로
      // 실패해서 어느 쪽인지 구분이 안 됐다. 단계를 기록해 로그만으로 판별한다.
      let stage: "r2_get" | "media_transform" | "read_frame" | "r2_put" = "r2_get";
      try {
        const video = await env.R2.get(source.object_key);
        if (!video) {
          skipped.push({ media_id: source.media_id, reason: "missing_object", detail: source.object_key });
          break;
        }
        stage = "media_transform";
        const result = env.MEDIA.input(await knownLengthBody(await video.arrayBuffer()))
          .transform({ width: FRAME_WIDTH, fit: "scale-down" })
          .output({ mode: "frame", time: `${timeSeconds}s`, format: "jpg" });
        const response = await result.response();
        if (!response.ok) throw new Error(`media transform ${response.status}`);
        stage = "read_frame";
        // R2.put 도 길이가 알려진 본문을 요구한다. 변환 응답 스트림을 그대로 넘기면
        // 입력과 똑같은 `must have a known length` 로 실패한다(프레임은 이미 만들어진 뒤).
        const frameBytes = await response.arrayBuffer();
        stage = "r2_put";
        await env.R2.put(key, frameBytes, {
          httpMetadata: { contentType: "image/jpeg" },
          customMetadata: { media_id: source.media_id, source_checksum: source.checksum, time_seconds: String(timeSeconds) },
        });
        frames.push({ media_id: source.media_id, frame_index: index, time_seconds: timeSeconds, object_key: key, cached: false });
      } catch (error) {
        skipped.push({ media_id: source.media_id, reason: "extraction_failed", detail: `[${stage}] ${String(error).slice(0, 180)}` });
      }
    }
  }

  return { frames, skipped };
}
