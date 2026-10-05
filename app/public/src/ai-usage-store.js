export class D1AiUsageStore {
  constructor(database) {
    if (!database) throw new TypeError("D1 database binding is required");
    this.database = database;
  }

  async reserve(gate, dimensions, now = new Date()) {
    if (!gate.quota) return { allowed: true, usage: 0, quota: 0 };
    const occurredAt = now.toISOString();
    const row = await this.database.prepare(`
      INSERT INTO studio_ai_usage_daily (
        dimension_key, usage_day, org, project, user_id, provider, model, task_type, request_count, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9)
      ON CONFLICT(dimension_key) DO UPDATE SET
        request_count = request_count + 1,
        updated_at = excluded.updated_at
      WHERE request_count < ?10
      RETURNING request_count
    `).bind(
      gate.dimensionKey,
      occurredAt.slice(0, 10),
      dimensions.org,
      dimensions.project,
      dimensions.user,
      dimensions.provider,
      dimensions.model,
      dimensions.taskType,
      occurredAt,
      gate.quota
    ).first();
    if (row) return { allowed: true, usage: Number(row.request_count), quota: gate.quota };
    const current = await this.database.prepare(
      "SELECT request_count FROM studio_ai_usage_daily WHERE dimension_key = ?1"
    ).bind(gate.dimensionKey).first();
    return { allowed: false, usage: Number(current?.request_count || gate.quota), quota: gate.quota };
  }

  async record(event) {
    const usage = event.usage || {};
    const dimensions = event.dimensions || {};
    await this.database.prepare(`
      INSERT INTO studio_ai_usage_events (
        response_id, project, provider, model, task_type, prompt_id, prompt_version,
        input_tokens, cached_tokens, billable_input_tokens, output_tokens,
        reasoning_tokens, total_tokens, occurred_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
    `).bind(
      event.responseId,
      dimensions.project || "project:default",
      dimensions.provider || "provider:unknown",
      dimensions.model || "model:unknown",
      dimensions.taskType || "task:unknown",
      event.prompt?.id || null,
      event.prompt?.version || null,
      usage.inputTokens || 0,
      usage.cachedTokens || 0,
      usage.billableInputTokens || 0,
      usage.outputTokens || 0,
      usage.reasoningTokens || 0,
      usage.totalTokens || 0,
      event.occurredAt || new Date().toISOString()
    ).run();
  }
}
