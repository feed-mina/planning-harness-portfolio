import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildVisionImages,
  MAX_INLINE_IMAGE_BYTES,
  MAX_VISION_IMAGES,
  MAX_VISION_PAYLOAD_BYTES,
  type VisionMedia,
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
const PREFIX = "nblog-frames/test/vision";

/** 미생맥주 캠페인 — 영상 6개 + 사진 1장, 방문 순서대로 */
const MISAENG: VisionMedia[] = [
  { media_id: "v1", type: "video", object_key: "vs/1.mp4", content_type: "video/mp4", size: 6_751_312, checksum: "a".repeat(64), duration: 3.944 },
  { media_id: "v2", type: "video", object_key: "vs/2.mp4", content_type: "video/mp4", size: 20_791_758, checksum: "b".repeat(64), duration: 12.141 },
  { media_id: "v3", type: "video", object_key: "vs/3.mp4", content_type: "video/mp4", size: 8_724_277, checksum: "c".repeat(64), duration: 5.355 },
  { media_id: "v4", type: "video", object_key: "vs/4.mp4", content_type: "video/mp4", size: 10_594_201, checksum: "d".repeat(64), duration: 6.528 },
  { media_id: "v5", type: "video", object_key: "vs/5.mp4", content_type: "video/mp4", size: 15_995_303, checksum: "e".repeat(64), duration: 9.519 },
  { media_id: "v6", type: "video", object_key: "vs/6.mp4", content_type: "video/mp4", size: 16_113_937, checksum: "f".repeat(64), duration: 9.375 },
  { media_id: "p7", type: "image", object_key: "vs/7.jpg", content_type: "image/jpeg", size: 2_618_283, checksum: "0".repeat(64), duration: null },
];

function stubMedia() {
  return {
    input(media: ReadableStream<Uint8Array>) {
      void media.cancel();
      return {
        transform: () => ({
          output: () => ({ response: async () => new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), { status: 200 }) }),
        }),
      };
    },
  };
}

function stubImages(calls: Array<{ width?: number }>) {
  return {
    input(image: ReadableStream<Uint8Array>) {
      void image.cancel();
      return {
        transform(options: { width?: number }) {
          calls.push(options);
          return {
            output: async () => ({
              image: () => new Response("ZG93bnNjYWxlZA==").body!,
            }),
          };
        },
      };
    },
  };
}

function testEnv(extra: Record<string, unknown> = {}): NBlogEnv {
  return { ...workerEnv, MEDIA: stubMedia(), ...extra } as unknown as NBlogEnv;
}

async function seed(items: VisionMedia[]): Promise<void> {
  for (const item of items) await workerEnv.R2.put(item.object_key, "fake-bytes");
}

async function clearFrames(): Promise<void> {
  const listed = await workerEnv.R2.list({ prefix: PREFIX });
  for (const object of listed.objects) await workerEnv.R2.delete(object.key);
}

describe("buildVisionImages", () => {
  // miniflare R2 초기화가 기본 훅 타임아웃(10s)을 넘길 때가 있습니다.
  beforeEach(async () => {
    await clearFrames();
    await seed(MISAENG);
  }, 30_000);

  it("미생맥주 캠페인에서 사진 1장 → 근거 이미지 16장으로 늘어난다", async () => {
    const { images, photo_count, frame_count } = await buildVisionImages(testEnv(), PREFIX, MISAENG);

    expect(frame_count).toBe(15);
    expect(photo_count).toBe(1);
    expect(images).toHaveLength(16);
    // Phase 2 인수조건: 13장 이상
    expect(images.length).toBeGreaterThanOrEqual(13);
  });

  it("사진을 먼저 넣고 프레임은 영상별로 돌아가며 넣는다", async () => {
    const { images } = await buildVisionImages(testEnv(), PREFIX, MISAENG);

    // 예산이 모자라면 뒤쪽이 잘린다. 영수증 사진처럼 메뉴명·가격이 그대로 보이는
    // 근거가 먼저 살아남아야 하므로 사진을 앞에 둔다.
    expect(images[0]).toMatchObject({ media_id: "p7", source: "photo" });

    // 앞 영상이 예산을 다 쓰고 뒤 영상이 통째로 빠지지 않도록 한 바퀴씩 돈다.
    const firstRound = images.slice(1, 7).map((image) => image.media_id);
    expect(firstRound).toEqual(["v1", "v2", "v3", "v4", "v5", "v6"]);
  });

  it("모든 이미지가 data URL 로 인라인된다", async () => {
    const { images } = await buildVisionImages(testEnv(), PREFIX, MISAENG);

    expect(images.every((image) => image.data_url.startsWith("data:image/"))).toBe(true);
    expect(images.filter((image) => image.source === "frame").every((image) => typeof image.time_seconds === "number")).toBe(true);
  });

  it("작은 사진도 항상 축소해서 싣는다 (요청 크기 억제)", async () => {
    // staging 회귀: 2.6MB 원본을 그대로 base64 로 실었더니 프레임이 붙은 뒤
    // 모델 호출이 `Network connection lost` 로 끊겼다.
    const calls: Array<{ width?: number }> = [];
    const { photo_count } = await buildVisionImages(testEnv({ IMAGES: stubImages(calls) }), PREFIX, [MISAENG[6]]);

    expect(photo_count).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.width).toBe(512);
  });

  it("4MB 초과 사진은 Images 바인딩으로 축소해 싣는다", async () => {
    const calls: Array<{ width?: number }> = [];
    const huge: VisionMedia = { media_id: "big", type: "image", object_key: "vs/big.jpg", content_type: "image/jpeg", size: MAX_INLINE_IMAGE_BYTES + 1, checksum: "9".repeat(64), duration: null };
    await seed([huge]);

    const { images, photo_count, skipped } = await buildVisionImages(testEnv({ IMAGES: stubImages(calls) }), PREFIX, [huge]);

    expect(photo_count).toBe(1);
    expect(skipped).toEqual([]);
    expect(calls[0]?.width).toBe(512);
    expect(images[0].data_url).toContain("base64,ZG93bnNjYWxlZA==");
  });

  it("사진 변환이 실패해도 나머지 근거로 생성을 계속한다", async () => {
    // 프레임 추출은 실패를 격리하고 있었는데 사진 경로만 빠져 있어, Images 변환이
    // 터지면 캠페인 전체 생성이 죽었다.
    const failingImages = {
      input() { throw new Error("Network connection lost."); },
    };

    const { images, photo_count, frame_count, skipped } = await buildVisionImages(
      testEnv({ IMAGES: failingImages }), PREFIX, MISAENG,
    );

    expect(photo_count).toBe(0);
    expect(frame_count).toBe(15);
    expect(images).toHaveLength(15);
    expect(skipped.some((item) => item.reason === "photo_failed")).toBe(true);
  });

  it("Images 바인딩이 없으면 4MB 초과 사진을 근거에서 빼고 이유를 남긴다", async () => {
    const huge: VisionMedia = { media_id: "big", type: "image", object_key: "vs/big2.jpg", content_type: "image/jpeg", size: MAX_INLINE_IMAGE_BYTES + 1, checksum: "8".repeat(64), duration: null };
    await seed([huge]);

    const { images, skipped } = await buildVisionImages(testEnv(), PREFIX, [huge]);

    expect(images).toEqual([]);
    expect(skipped[0]).toMatchObject({ media_id: "big", reason: "too_large_no_images_binding" });
  });

  it("총 이미지 수가 상한을 넘지 않는다", async () => {
    const many: VisionMedia[] = Array.from({ length: 30 }, (_, index) => ({
      media_id: `p${index}`, type: "image" as const, object_key: `vs/many-${index}.jpg`,
      content_type: "image/jpeg", size: 1_000, checksum: String(index).padStart(64, "0"), duration: null,
    }));
    await seed(many);

    const { images } = await buildVisionImages(testEnv(), PREFIX, many);

    expect(images).toHaveLength(MAX_VISION_IMAGES);
  });

  /**
   * staging 회귀: #171 로 프레임을 17장까지 늘리자 페이로드가 1,724KB 가 되어
   * `Network connection lost` 로 다시 실패했다. 장수 상한(20)은 넘지 않았다 —
   * 터지는 단위는 장수가 아니라 바이트다.
   */
  describe("요청 크기 예산", () => {
    /** data URL 한 장이 대략 이만큼이 되도록 R2 에 큰 객체를 심는다. */
    async function seedHeavy(count: number, bytesEach: number): Promise<VisionMedia[]> {
      const heavy: VisionMedia[] = [];
      for (let index = 0; index < count; index += 1) {
        const item: VisionMedia = {
          media_id: `h${index}`, type: "image", object_key: `vs/heavy-${index}.jpg`,
          content_type: "image/jpeg", size: bytesEach, checksum: String(index).padStart(64, "7"), duration: null,
        };
        await workerEnv.R2.put(item.object_key, "x".repeat(bytesEach));
        heavy.push(item);
      }
      return heavy;
    }

    it("총 바이트가 예산을 넘지 않는다", async () => {
      const heavy = await seedHeavy(12, 200 * 1024);

      const { images } = await buildVisionImages(testEnv(), PREFIX, heavy);

      const total = images.reduce((sum, image) => sum + image.data_url.length, 0);
      expect(total).toBeLessThanOrEqual(MAX_VISION_PAYLOAD_BYTES);
      // 장수 상한(20)에는 한참 못 미치는데도 멈춰야 한다.
      expect(images.length).toBeLessThan(MAX_VISION_IMAGES);
    });

    it("예산에 걸려 뺀 근거는 이유를 남긴다", async () => {
      const heavy = await seedHeavy(12, 200 * 1024);

      const { skipped } = await buildVisionImages(testEnv(), PREFIX, heavy);

      expect(skipped.some((item) => item.reason === "vision_budget_reached")).toBe(true);
    });

    it("예산이 빠듯해도 영상마다 최소 한 장씩은 들어간다", async () => {
      // 프레임이 균등하게 들어가는지 — 앞 영상이 예산을 독차지하면 안 된다.
      const { images } = await buildVisionImages(testEnv(), PREFIX, MISAENG);
      const videosSeen = new Set(images.filter((image) => image.source === "frame").map((image) => image.media_id));

      expect(videosSeen.size).toBe(6);
    });

    it("평소 캠페인은 예산에 걸리지 않는다", async () => {
      const { skipped, images } = await buildVisionImages(testEnv(), PREFIX, MISAENG);

      expect(skipped.some((item) => item.reason === "vision_budget_reached")).toBe(false);
      expect(images).toHaveLength(16);
    });
  });

  it("MEDIA 바인딩이 없어도 사진만으로 근거를 만든다", async () => {
    const { images, photo_count, frame_count } = await buildVisionImages(
      { ...workerEnv, MEDIA: undefined } as unknown as NBlogEnv,
      PREFIX,
      MISAENG,
    );

    expect(frame_count).toBe(0);
    expect(photo_count).toBe(1);
    expect(images).toHaveLength(1);
  });
});
