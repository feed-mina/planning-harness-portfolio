import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  extractVideoFrames,
  frameCountFor,
  frameTimestamps,
  knownLengthBody,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  type FrameSource,
} from "../src/domains/nblog";
import type { NBlogEnv } from "../src/domains/nblog";

declare module "cloudflare:workers" {
  namespace Cloudflare {
    interface Env {
      R2: R2Bucket;
    }
  }
}

const workerEnv = env as unknown as NBlogEnv;
const PREFIX = "nblog-frames/test/campaign-misaeng";

/** 미생맥주 캠페인(source/0712_미생맥주/)의 실제 영상 6개 — 회귀 기준 */
const MISAENG_VIDEOS: FrameSource[] = [
  { media_id: "v1", object_key: "src/20260712_192901.mp4", checksum: "a".repeat(64), duration: 3.944, size: 6_751_312 },
  { media_id: "v2", object_key: "src/20260712_192911.mp4", checksum: "b".repeat(64), duration: 12.141, size: 20_791_758 },
  { media_id: "v3", object_key: "src/20260712_193150.mp4", checksum: "c".repeat(64), duration: 5.355, size: 8_724_277 },
  { media_id: "v4", object_key: "src/20260712_194232.mp4", checksum: "d".repeat(64), duration: 6.528, size: 10_594_201 },
  { media_id: "v5", object_key: "src/20260712_194511.mp4", checksum: "e".repeat(64), duration: 9.519, size: 15_995_303 },
  { media_id: "v6", object_key: "src/20260712_203058.mp4", checksum: "f".repeat(64), duration: 9.375, size: 16_113_937 },
];

type StubOptions = { failFor?: Set<string>; };

function stubMedia(calls: Array<{ time?: string }>, options: StubOptions = {}) {
  let pending: string | null = null;
  return {
    input(media: ReadableStream<Uint8Array>) {
      // 주의: 실제 Media 바인딩은 "길이를 아는 스트림"만 받는다(FixedLengthStream 또는
      // request/response body). 스텁으로는 그 제약을 재현할 수 없어 이 계층의 테스트는
      // 바인딩 계약 위반을 잡지 못한다 — knownLengthStream 단위 테스트로 보완한다.
      // 스트림을 실제로 소비해 "한 번만 읽을 수 있음"을 테스트에서도 강제합니다.
      void media.cancel();
      return {
        transform() {
          return {
            output(output?: { time?: string }) {
              calls.push({ time: output?.time });
              pending = output?.time ?? null;
              return {
                async response() {
                  if (options.failFor?.has(String(pending))) return new Response("boom", { status: 500 });
                  return new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), { status: 200 });
                },
              };
            },
          };
        },
      };
    },
  };
}

async function seedVideos(sources: FrameSource[]): Promise<void> {
  for (const source of sources) await workerEnv.R2.put(source.object_key, "fake-mp4-bytes");
}

async function clearFrames(): Promise<void> {
  const listed = await workerEnv.R2.list({ prefix: PREFIX });
  for (const object of listed.objects) await workerEnv.R2.delete(object.key);
}

describe("knownLengthBody", () => {
  // 실제 staging 에서 6개 영상 전부가 이 계약 위반으로 실패했다:
  // "Provided readable stream must have a known length"
  it("R2 내용을 그대로 전달한다", async () => {
    const payload = "fake-mp4-bytes";
    await workerEnv.R2.put("known-length/sample.mp4", payload);
    const object = await workerEnv.R2.get("known-length/sample.mp4");

    const body = await knownLengthBody(await object!.arrayBuffer());

    expect(await new Response(body).text()).toBe(payload);
  });

  it("바이트 수가 보존된다", async () => {
    const payload = "abcdef";
    await workerEnv.R2.put("known-length/other.mp4", payload);
    const object = await workerEnv.R2.get("known-length/other.mp4");

    const body = await knownLengthBody(await object!.arrayBuffer());

    expect((await new Response(body).arrayBuffer()).byteLength).toBe(payload.length);
  });

  // ⚠️ 바인딩이 요구하는 "known length" 는 스트림 내부 속성이라 테스트에서 관측할 수
  // 없다. FixedLengthStream 방식도 로컬 테스트는 통과했지만 staging 에서 실패했다.
  // 이 계층의 검증은 staging 실행 로그로만 확정된다.
});

describe("frame planning", () => {
  it("길이에 따라 프레임 수를 정한다", () => {
    expect(frameCountFor(2)).toBe(1);
    expect(frameCountFor(5.355)).toBe(2);
    expect(frameCountFor(12.141)).toBe(3);
  });

  it("duration 을 모르면 고정 지점 여러 곳을 시도한다", () => {
    // 길이 저장(#171) 이전에 올라온 영상. 뒤 시점은 실패할 수 있지만 프레임 단위로
    // 격리되므로 앞쪽은 살아남는다 — 한 장만 뽑던 이전보다 근거가 늘어난다.
    expect(frameTimestamps(null)).toEqual([0, 2, 5]);
    expect(frameTimestamps(0)).toEqual([0, 2, 5]);
  });

  it("첫·끝 프레임을 피해 구간을 균등 분할한다", () => {
    const stamps = frameTimestamps(12);
    expect(stamps).toEqual([3, 6, 9]);
    expect(stamps[0]).toBeGreaterThan(0);
    expect(stamps.at(-1)).toBeLessThan(12);
  });
});

describe("extractVideoFrames", () => {
  beforeEach(async () => {
    await clearFrames();
    await seedVideos(MISAENG_VIDEOS);
  });

  it("미생맥주 6개 영상 전부에서 프레임을 추출한다", async () => {
    const calls: Array<{ time?: string }> = [];
    const testEnv = { ...workerEnv, MEDIA: stubMedia(calls) } as unknown as NBlogEnv;

    const { frames, skipped } = await extractVideoFrames(testEnv, PREFIX, MISAENG_VIDEOS);

    expect(skipped).toEqual([]);
    // 2 + 3 + 2 + 2 + 3 + 3 = 15
    expect(frames).toHaveLength(15);
    expect(new Set(frames.map((frame) => frame.media_id)).size).toBe(6);
    expect(calls).toHaveLength(15);
  });

  it("추출한 프레임을 R2 에 저장하고 재실행 시 재호출하지 않는다", async () => {
    const firstCalls: Array<{ time?: string }> = [];
    await extractVideoFrames({ ...workerEnv, MEDIA: stubMedia(firstCalls) } as unknown as NBlogEnv, PREFIX, MISAENG_VIDEOS);
    expect(firstCalls).toHaveLength(15);

    const secondCalls: Array<{ time?: string }> = [];
    const { frames } = await extractVideoFrames({ ...workerEnv, MEDIA: stubMedia(secondCalls) } as unknown as NBlogEnv, PREFIX, MISAENG_VIDEOS);

    expect(secondCalls).toHaveLength(0);
    expect(frames).toHaveLength(15);
    expect(frames.every((frame) => frame.cached)).toBe(true);
  });

  it("checksum 이 바뀌면 캐시를 재사용하지 않는다", async () => {
    await extractVideoFrames({ ...workerEnv, MEDIA: stubMedia([]) } as unknown as NBlogEnv, PREFIX, [MISAENG_VIDEOS[0]]);

    const calls: Array<{ time?: string }> = [];
    const reuploaded = { ...MISAENG_VIDEOS[0], checksum: "9".repeat(64) };
    const { frames } = await extractVideoFrames({ ...workerEnv, MEDIA: stubMedia(calls) } as unknown as NBlogEnv, PREFIX, [reuploaded]);

    expect(calls).toHaveLength(2);
    expect(frames.every((frame) => !frame.cached)).toBe(true);
  });

  it("100MB·10분 초과 입력은 변환을 호출하지 않고 건너뛴다", async () => {
    const calls: Array<{ time?: string }> = [];
    const oversized: FrameSource[] = [
      { media_id: "big", object_key: "src/big.mp4", checksum: "1".repeat(64), duration: 30, size: MAX_VIDEO_BYTES + 1 },
      { media_id: "long", object_key: "src/long.mp4", checksum: "2".repeat(64), duration: MAX_VIDEO_SECONDS + 1, size: 1_000 },
    ];
    await seedVideos(oversized);

    const { frames, skipped } = await extractVideoFrames({ ...workerEnv, MEDIA: stubMedia(calls) } as unknown as NBlogEnv, PREFIX, oversized);

    expect(frames).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(skipped.map((item) => item.reason)).toEqual(["too_large", "too_long"]);
  });

  it("한 영상이 실패해도 나머지 영상은 계속 추출한다", async () => {
    const calls: Array<{ time?: string }> = [];
    // v1 의 두 타임스탬프만 실패시킵니다.
    const failFor = new Set(frameTimestamps(MISAENG_VIDEOS[0].duration).map((time) => `${time}s`));
    const testEnv = { ...workerEnv, MEDIA: stubMedia(calls, { failFor }) } as unknown as NBlogEnv;

    const { frames, skipped } = await extractVideoFrames(testEnv, PREFIX, MISAENG_VIDEOS);

    expect(frames).toHaveLength(13);
    expect(frames.some((frame) => frame.media_id === "v1")).toBe(false);
    expect(skipped.every((item) => item.reason === "extraction_failed")).toBe(true);
    expect(new Set(frames.map((frame) => frame.media_id)).size).toBe(5);
  });

  it("R2 에 원본이 없으면 해당 영상만 건너뛴다", async () => {
    const calls: Array<{ time?: string }> = [];
    const missing: FrameSource = { media_id: "gone", object_key: "src/gone.mp4", checksum: "3".repeat(64), duration: 5, size: 1_000 };

    const { frames, skipped } = await extractVideoFrames(
      { ...workerEnv, MEDIA: stubMedia(calls) } as unknown as NBlogEnv,
      PREFIX,
      [missing, MISAENG_VIDEOS[1]],
    );

    expect(skipped[0]).toMatchObject({ media_id: "gone", reason: "missing_object" });
    expect(frames.every((frame) => frame.media_id === "v2")).toBe(true);
    expect(frames).toHaveLength(3);
  });

  it("캠페인당 프레임 상한을 넘지 않는다", async () => {
    const calls: Array<{ time?: string }> = [];
    const testEnv = { ...workerEnv, MEDIA: stubMedia(calls), NBLOG_MAX_VIDEO_FRAMES: "5" } as unknown as NBlogEnv;

    const { frames, skipped } = await extractVideoFrames(testEnv, PREFIX, MISAENG_VIDEOS);

    expect(frames).toHaveLength(5);
    expect(calls).toHaveLength(5);
    expect(skipped.at(-1)?.reason).toBe("frame_cap_reached");
  });

  it("MEDIA 바인딩이 없으면 예외 없이 빈 결과를 준다", async () => {
    const { frames, skipped } = await extractVideoFrames(
      { ...workerEnv, MEDIA: undefined } as unknown as NBlogEnv,
      PREFIX,
      MISAENG_VIDEOS,
    );

    expect(frames).toEqual([]);
    expect(skipped).toEqual([]);
  });
});
