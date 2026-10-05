import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runNBlogWorkflowReconciliation, type NBlogEnv, type NBlogWorkflowParams } from "./nblog";
import { markGenerationFailed, runNBlogWorkerGeneration } from "./nblogGeneration";

export class NBlogWorkflow extends WorkflowEntrypoint<NBlogEnv, NBlogWorkflowParams> {
  async run(event: WorkflowEvent<NBlogWorkflowParams>, step: WorkflowStep): Promise<{ status: string; missing: string[] }> {
    const params = event.payload;
    if (!params?.user_id || !params.campaign_id || !params.requested_by) {
      throw new Error("NBlog Workflow params are invalid");
    }
    if (params.reason === "generate") {
      try {
        const generated = await step.do("generate-draft-from-media", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" }, async () => {
          return runNBlogWorkerGeneration(this.env, params);
        });
        return { status: generated.status, missing: [] };
      } catch (error) {
        await step.do("record-generation-failure", async () => markGenerationFailed(this.env, params, error));
        throw error;
      }
    }
    return step.do("reconcile-artifact-checkpoint", { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "2 minutes" }, async () => {
      return runNBlogWorkflowReconciliation(this.env, params);
    });
  }
}
