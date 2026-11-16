import type { TestDefinition } from '@orbit/contract';
import { caseMatches } from './junit';
import type { Walkthrough, WalkthroughStep } from './walkthrough';

type Attachment = { name?: string; contentType?: string; path?: string; body?: string; base64?: string };
type Step = { title?: string; category?: string; location?: object; skipped?: boolean; steps?: Step[]; attachments?: number[] };
type Result = { status?: string; startTime?: string; steps?: Step[]; attachments?: Attachment[] };
type Test = { title: string; path?: string[]; location?: { file?: string }; projectName?: string; results?: Result[] };

/** Read Playwright's embedded report data as text. The report's HTML and JavaScript are never opened. */
export async function parsePlaywrightWalkthroughs(html: string, definitions: TestDefinition[]): Promise<Map<string, Walkthrough> | null> {
  const archive = /<script id="playwrightReportBase64"[^>]*>data:application\/zip;base64,([\s\S]+?)<\/script>/.exec(html)?.[1];
  if (!archive) return null;
  const tests = new Map<string, Walkthrough>();
  for (const file of await readTestFiles(decodeBase64(archive))) {
    for (const test of [...file.tests].sort((a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? ''))) {
      const result = test.results?.slice().reverse().find((attempt) => attempt.status === 'passed');
      if (!result || typeof test.title !== 'string') continue;
      const name = [...(test.path ?? []), test.title].join(' › ');
      const location = test.location?.file || file.fileName || '';
      const matched = definitions.filter((definition) => !definition.placeholder && !tests.has(definition.id) && caseMatches(definition, { file: location, name, status: 'passed' }));
      if (!matched.length) continue;
      const steps = recordingSteps(result);
      if (steps.length) {
        for (const definition of matched) tests.set(definition.id, { steps, recordedAt: result.startTime });
      }
    }
  }
  return tests;
}

function recordingSteps(result: Result, blob = false): WalkthroughStep[] {
  const output: WalkthroughStep[] = [];
  const seen = new Set<number>();
  const attachments = result.attachments ?? [];
  function add(title: string, media: Attachment[], expectations: string[] = []) {
    const description = [title, ...media.filter((a) => a.contentType?.startsWith('text/plain')).map((a) => a.body?.trim())].filter(Boolean).join('\n\n');
    const images = media.flatMap((a) => a.contentType?.startsWith('image/') && a.path && /^(?:data|resources)\/[\w.-]+\.(?:png|jpe?g|webp)$/i.test(a.path) ? [a.path] : []);
    const details = { ...(description ? { description } : {}), ...(expectations.length ? { expectations } : {}) };
    if (images.length) for (const image of images) output.push({ ...details, image });
    else if (description || expectations.length) output.push(details);
  }
  function visit(step: Step) {
    if (step.skipped) return;
    const media = (step.attachments ?? []).flatMap((index) => {
      seen.add(index);
      return attachments[index] ? [attachments[index]] : [];
    });
    const title = step.title?.trim() ?? '';
    if (blob) {
      if (step.category === 'test.step') {
        add(title, media, (step.steps ?? []).flatMap((child) => child.category === 'expect' && !child.skipped && child.title
          ? [expectationTitle(child.title)]
          : []));
        step.steps?.forEach(visit);
      } else if (media.length) {
        add('', media);
      }
      return;
    }
    if (title.startsWith('Expected:')) return;
    // HTML exposes step titles, but omits Playwright's internal step category.
    const action = /^(?:Expect\b|Attach "|Screenshot\b|(?:Navigate|Click|Fill|Press|Select option|Wait for|Get |Set |Check|Uncheck|Evaluate|Scroll|Hover|Reload|Clear|Dispatch|Focus|Blur) (?:\S+\(|"|time\b|to\b|for\b))/.test(title);
    const description = step.location && !action ? title : '';
    const expectations = step.steps?.flatMap((child) => {
      const assertion = child.title?.match(/^Expected:\s*(.+)$/s)?.[1]?.trim();
      return !child.skipped && assertion ? [assertion] : [];
    }) ?? [];
    if (description || media.length || expectations.length) add(description, media, expectations);
    step.steps?.forEach(visit);
  }
  const topLevelExpectations = blob ? (result.steps ?? []).flatMap((step) => step.category === 'expect' && !step.skipped && step.title
    ? [expectationTitle(step.title)] : []) : [];
  result.steps?.forEach(visit);
  if (topLevelExpectations.length) add('', [], topLevelExpectations);
  attachments.forEach((attachment, index) => {
    if (!seen.has(index) && attachment.name !== 'stdout' && attachment.name !== 'stderr') add('', [attachment]);
  });
  return output;
}

function expectationTitle(title: string): string {
  // Render older assertion messages without the label they already used in Orbit.
  return title.trim().replace(/^Expected:\s+/, '');
}

function decodeBase64(base64: string) {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

type BlobSuite = { title: string; entries: (BlobSuite | { testId: string; title: string; location?: { file?: string } })[] };
type BlobEvent = {
  method: string;
  params?: {
    project?: { name: string; suites: BlobSuite[] };
    testId?: string;
    resultId?: string;
    test?: { testId: string };
    result?: { id: string; startTime?: number; status?: string };
    step?: Step & { id: string; parentStepId?: string; annotations?: { type: string }[] };
    attachments?: Attachment[];
  };
};

/** Blob reports preserve Playwright's own categories, even for assertions with custom titles. */
export async function parsePlaywrightBlob(bytes: ArrayBuffer, definitions: TestDefinition[]): Promise<Map<string, Walkthrough> | null> {
  const archive = readZip(new Uint8Array(bytes));
  const data = await archive.get('report.jsonl')?.(32 * 1024 * 1024);
  if (!data) return null;

  const tests = new Map<string, Test>();
  const attempts = new Map<string, Result & { stepById: Map<string, Step> }>();
  const decoder = new TextDecoder();
  const events = decoder.decode(data).trimEnd().split('\n');
  function visitSuite(suite: BlobSuite, projectName: string, path: string[]) {
    for (const entry of suite.entries) {
      if ('testId' in entry) tests.set(entry.testId, { ...entry, path, projectName, results: [] });
      else visitSuite(entry, projectName, [...path, entry.title]);
    }
  }
  for (const line of events) {
    const { method, params } = JSON.parse(line) as BlobEvent;
    if (!params) continue;
    const { project, result, resultId, step, attachments } = params;
    if (method === 'onProject' && project) {
      for (const suite of project.suites) visitSuite(suite, project.name, []);
    } else if (method === 'onTestBegin' && params.testId && result) {
      const attempt = {
        startTime: typeof result.startTime === 'number' ? new Date(result.startTime).toISOString() : undefined,
        steps: [], attachments: [], stepById: new Map<string, Step>(),
      };
      attempts.set(result.id, attempt);
      tests.get(params.testId)?.results?.push(attempt);
    } else if (method === 'onTestEnd' && result) {
      const attempt = attempts.get(result.id);
      if (attempt) attempt.status = result.status;
      attempts.delete(result.id);
    } else if (resultId) {
      const attempt = attempts.get(resultId);
      if (!attempt) continue;
      if (method === 'onStepBegin' && step) {
        const parent = step.parentStepId ? attempt.stepById.get(step.parentStepId) : undefined;
        (parent ? (parent.steps ??= []) : (attempt.steps ??= [])).push(step);
        attempt.stepById.set(step.id, step);
      } else if (method === 'onStepEnd' && step) {
        const started = attempt.stepById.get(step.id);
        if (started) {
          started.attachments = step.attachments;
          started.skipped = step.annotations?.some((annotation) => annotation.type === 'skip');
        }
      } else if (method === 'onAttach' && attachments) {
        attempt.attachments?.push(...attachments);
      }
    }
  }

  const output = new Map<string, Walkthrough>();
  const inlineImages = new Map<string, string>();
  const imageExtensions = new Map([['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/webp', 'webp']]);
  const readImage = async (path: string) => {
    const limit = 16 * 1024 * 1024;
    const inline = inlineImages.get(path);
    const image = inline && inline.length <= Math.ceil(limit / 3) * 4 ? decodeBase64(inline).buffer : await archive.get(path)?.(limit);
    if (!image || image.byteLength > limit) throw new Error('Screenshot file is unavailable.');
    return image;
  };
  for (const test of [...tests.values()].sort((a, b) => (a.projectName ?? '').localeCompare(b.projectName ?? ''))) {
    const result = test.results?.slice().reverse().find((attempt) => attempt.status === 'passed');
    if (!result) continue;
    const name = [...(test.path ?? []), test.title].join(' › ');
    const matches = definitions.filter((definition) => !definition.placeholder && !output.has(definition.id)
      && caseMatches(definition, { file: test.location?.file ?? '', name, status: 'passed' }));
    if (!matches.length) continue;
    for (const attachment of result.attachments ?? []) {
      const extension = imageExtensions.get(attachment.contentType ?? '');
      if (extension && attachment.base64 && !attachment.path) {
        attachment.path = `resources/inline-${inlineImages.size}.${extension}`;
        inlineImages.set(attachment.path, attachment.base64);
      } else if (attachment.contentType?.startsWith('text/plain')) {
        const limit = 1024 * 1024;
        const body = attachment.base64 && attachment.base64.length <= Math.ceil(limit / 3) * 4
          ? decodeBase64(attachment.base64)
          : attachment.path && await archive.get(attachment.path)?.(limit);
        if (body) attachment.body = decoder.decode(body);
      }
    }
    const steps = recordingSteps(result, true);
    if (steps.length) for (const definition of matches) output.set(definition.id, { steps, recordedAt: result.startTime, readImage });
  }
  return output;
}

/** The HTML reporter stores one JSON entry per spec file in a ZIP central directory. */
async function readTestFiles(bytes: Uint8Array): Promise<{ fileName?: string; tests: Test[] }[]> {
  const files: { fileName?: string; tests: Test[] }[] = [];
  for (const [name, read] of readZip(bytes)) {
    if (!/^[a-f\d]{20}\.json$/.test(name)) continue;
    const file = JSON.parse(new TextDecoder().decode(await read(32 * 1024 * 1024)));
    if (Array.isArray(file?.tests)) files.push(file);
  }
  return files;
}

function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  const end = bytes.length - 22; // Playwright writes no ZIP comment.
  if (end < 0 || u32(end) !== 0x06054b50) throw new Error('Invalid Playwright report archive');
  const entries = new Map<string, (limit: number) => Promise<ArrayBuffer>>();
  let offset = u32(end + 16);
  const decoder = new TextDecoder();
  for (let i = 0; i < u16(end + 10); i++) {
    if (u32(offset) !== 0x02014b50) throw new Error('Invalid Playwright report entry');
    const nameLength = u16(offset + 28);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const local = u32(offset + 42);
    const size = u32(offset + 24);
    const compressedSize = u32(offset + 20);
    const method = u16(offset + 10);
    entries.set(name, async (limit) => {
      if (u32(local) !== 0x04034b50 || size > limit) throw new Error('Invalid Playwright report entry');
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      if (start + compressedSize > bytes.length) throw new Error('Truncated Playwright report entry');
      const data = bytes.slice(start, start + compressedSize);
      if (method !== 0 && method !== 8) throw new Error('Unsupported Playwright report compression');
      if (method === 0 && data.length === size) return data.buffer;
      if (method === 0) throw new Error('Invalid Playwright report entry size');
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const content = new Uint8Array(size);
      let written = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (written + value.length > size) {
          await reader.cancel();
          throw new Error('Invalid Playwright report entry size');
        }
        content.set(value, written);
        written += value.length;
      }
      if (written !== size) throw new Error('Truncated Playwright report entry');
      return content.buffer;
    });
    offset += 46 + nameLength + u16(offset + 30) + u16(offset + 32);
  }
  return entries;
}
