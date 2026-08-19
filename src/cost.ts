export class BudgetExceededError extends Error {
  constructor(limitUsd: number, spentUsd: number) {
    super(
      `Cost limit of $${limitUsd.toFixed(2)} reached (spent $${spentUsd.toFixed(3)}). ` +
        `Resume with a higher limit: research-panel resume <session-dir> --max-cost <usd>`,
    );
    this.name = 'BudgetExceededError';
  }
}

/** Tracks cumulative OpenRouter spend across a session and enforces the hard cap. */
export class CostTracker {
  private spent: number;
  private warned = false;

  constructor(
    private readonly limitUsd: number,
    initialSpentUsd = 0,
  ) {
    this.spent = initialSpentUsd;
  }

  add(costUsd: number): void {
    if (Number.isFinite(costUsd) && costUsd > 0) this.spent += costUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }

  get limit(): number {
    return this.limitUsd;
  }

  /** True once spend crosses 80% of the limit; fires only once. */
  shouldWarn(): boolean {
    if (!this.warned && this.spent >= this.limitUsd * 0.8) {
      this.warned = true;
      return true;
    }
    return false;
  }

  /** Throws BudgetExceededError if the limit has been reached. */
  ensure(): void {
    if (this.spent >= this.limitUsd) throw new BudgetExceededError(this.limitUsd, this.spent);
  }
}
