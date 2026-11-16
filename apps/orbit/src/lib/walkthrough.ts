export const WALKTHROUGH_FILENAME = 'orbit.walkthroughs.json';

export interface WalkthroughStep {
  description?: string;
  image?: string;
  expectations?: string[];
}

export interface Walkthrough {
  recordedAt?: string;
  steps: WalkthroughStep[];
  readImage?: (path: string) => Promise<ArrayBuffer>;
}

export interface WalkthroughReport {
  path: string;
  sha: string;
  tests: Map<string, Walkthrough>;
}

export function parseWalkthroughs(text: string): Map<string, Walkthrough> {
  const tests = new Map<string, Walkthrough>();
  try {
    const report: unknown = JSON.parse(text);
    if (!record(report) || report.version !== 1 || !record(report.tests)) return tests;
    for (const [id, test] of Object.entries(report.tests)) {
      if (!record(test) || !Array.isArray(test.steps)) continue;
      const steps: WalkthroughStep[] = [];
      for (const step of test.steps) {
        if (!record(step)) continue;
        const description = typeof step.description === 'string' ? step.description.trim() : '';
        const image = typeof step.image === 'string' && /^walkthroughs\/(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp)$/i.test(step.image)
          && !step.image.split('/').some((segment) => segment === '.' || segment === '..') ? step.image : undefined;
        const expectations = Array.isArray(step.expectations) ? step.expectations.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : []) : [];
        if (description || image || expectations.length) steps.push({
          ...(description ? { description } : {}),
          ...(image ? { image } : {}),
          ...(expectations.length ? { expectations } : {}),
        });
      }
      if (steps.length) tests.set(id, { steps, ...(typeof test.recordedAt === 'string' && Number.isFinite(Date.parse(test.recordedAt)) ? { recordedAt: test.recordedAt } : {}) });
    }
  } catch {
    // An unavailable or invalid walkthrough file does not affect validation results.
  }
  return tests;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
