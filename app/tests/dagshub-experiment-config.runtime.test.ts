import { describe, expect, it } from "vitest";
import {
  DAGSHUB_EVAL_EXPERIMENT,
  DAGSHUB_USAGE_EXPERIMENT,
  evalExperiment,
  runTags,
  usageExperiment,
  type DagsHubConfig,
} from "../src/dagshub";
import { deployEnvironment } from "../src/env";

const stagingConfig: DagsHubConfig = {
  baseUrl: "https://dagshub.example/repo.mlflow",
  token: "t",
  repo: "owner/repo",
  environment: "staging",
};

describe("dagshub experiment names", () => {
  it("keeps the production experiments when no override is configured", () => {
    expect(evalExperiment({})).toBe(DAGSHUB_EVAL_EXPERIMENT);
    expect(usageExperiment({})).toBe(DAGSHUB_USAGE_EXPERIMENT);
  });

  it("uses isolated staging experiments from environment variables", () => {
    expect(evalExperiment({ DAGSHUB_EVAL_EXPERIMENT: " staging-ai-eval " })).toBe("staging-ai-eval");
    expect(usageExperiment({ DAGSHUB_USAGE_EXPERIMENT: " staging-usage " })).toBe("staging-usage");
  });

  it("falls back to the production experiments when the override is blank", () => {
    expect(evalExperiment({ DAGSHUB_EVAL_EXPERIMENT: "   " })).toBe(DAGSHUB_EVAL_EXPERIMENT);
    expect(usageExperiment({ DAGSHUB_USAGE_EXPERIMENT: "" })).toBe(DAGSHUB_USAGE_EXPERIMENT);
  });
});

describe("deploy environment name", () => {
  it("reads the configured environment and defaults to production", () => {
    expect(deployEnvironment({ ANALYTICS_ENVIRONMENT: " staging " })).toBe("staging");
    expect(deployEnvironment({})).toBe("production");
  });
});

describe("dagshub run tags", () => {
  it("tags every run with its source and deployment environment", () => {
    expect(runTags(stagingConfig, {
      experiment: "staging-usage",
      source: "usage",
      runName: "openai/gpt-5-mini · meeting_summary",
      tags: { stage: "meeting_summary" },
    })).toMatchObject({
      "mlflow.runName": "openai/gpt-5-mini · meeting_summary",
      stage: "meeting_summary",
      source: "usage",
      environment: "staging",
    });
  });

  it("does not let a caller tag override source or environment", () => {
    expect(runTags(stagingConfig, {
      experiment: "staging-ai-eval",
      source: "eval",
      runName: "run",
      tags: { source: "production", environment: "production" },
    })).toMatchObject({ source: "eval", environment: "staging" });
  });
});
