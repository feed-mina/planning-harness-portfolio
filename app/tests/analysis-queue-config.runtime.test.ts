import { describe, expect, it } from "vitest";
import {
  ANALYSIS_INDEX_DLQ_NAME,
  ANALYSIS_INDEX_QUEUE_NAME,
  configuredAnalysisQueueNames,
} from "../src/domains/analysis";

describe("analysis queue environment names", () => {
  it("keeps the production names when no override is configured", () => {
    expect(configuredAnalysisQueueNames({})).toEqual({
      queueName: ANALYSIS_INDEX_QUEUE_NAME,
      dlqName: ANALYSIS_INDEX_DLQ_NAME,
    });
  });

  it("uses isolated staging names from environment variables", () => {
    expect(configuredAnalysisQueueNames({
      ANALYSIS_INDEX_QUEUE_NAME: " harness-analysis-index-staging ",
      ANALYSIS_INDEX_DLQ_NAME: " harness-analysis-index-staging-dlq ",
    })).toEqual({
      queueName: "harness-analysis-index-staging",
      dlqName: "harness-analysis-index-staging-dlq",
    });
  });
});
