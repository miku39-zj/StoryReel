/** Bounded budgets for structured creation tasks, independent of the provider and HTTP transport. */
export const creationPolicy = {
  story: { timeoutMs: 300000, maxTokens: 8000 },
  branch: { timeoutMs: 300000, maxTokens: 8000 },
  storyboard: { timeoutMs: 600000, maxTokens: 16000 },
} as const;
