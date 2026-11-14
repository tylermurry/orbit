import { describe, expect, it } from 'vitest';
import { parseContract } from '@orbit/contract';
import { canUndo, currentText, initialState, inspectedCommit, isDirty, reducer, structuredDirty } from '../../src/state/store';
import { FILE, INVALID, SHA1, TASKY, setup } from './util';

const rename = (name: string) => (c: import('@orbit/contract').OrbitContract) => ({
  ...c,
  entities: c.entities.map((e) => (e.id === 'cap.task-management' ? { ...e, name } : e)),
});

describe('document store', () => {
  it('opens a valid file as clean, editable state', async () => {
    const { store, ctrl } = setup();
    expect(await ctrl.openPath(FILE)).toBe(true);
    const s = store.getState();
    expect(s.filePath).toBe(FILE);
    expect(s.loadedInvalid).toBe(false);
    expect(s.contract?.product.id).toBe('tasky');
    expect(isDirty(s)).toBe(false);
    expect(s.diskSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tracks dirty state and undo/redo of structured edits', async () => {
    const { store, ctrl } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('Renamed') });
    expect(isDirty(store.getState())).toBe(true);
    expect(canUndo(store.getState())).toBe(true);
    store.dispatch({ type: 'undo' });
    expect(isDirty(store.getState())).toBe(false);
    expect(store.getState().redo).toHaveLength(1);
    store.dispatch({ type: 'redo' });
    expect(isDirty(store.getState())).toBe(true);
    expect(store.getState().contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Renamed');
  });

  it('is not dirty after an edit is manually reverted', async () => {
    const { store, ctrl } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('X') });
    store.dispatch({ type: 'edit', fn: rename('Task Management') });
    expect(structuredDirty(store.getState())).toBe(false);
  });

  it('a new edit clears the redo stack', async () => {
    const { store, ctrl } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('A') });
    store.dispatch({ type: 'undo' });
    store.dispatch({ type: 'edit', fn: rename('B') });
    expect(store.getState().redo).toHaveLength(0);
  });

  it('opens an invalid file read-only, keeps the original text, and ignores edits', async () => {
    const { store, ctrl } = setup({}, INVALID);
    await ctrl.openPath(FILE);
    const s = store.getState();
    expect(s.loadedInvalid).toBe(true);
    expect(s.diagnosticsOpen).toBe(true);
    expect(s.diskText).toBe(INVALID);
    expect(currentText(s)).toBe(INVALID);
    expect(isDirty(s)).toBe(false);
    store.dispatch({ type: 'edit', fn: rename('Nope') });
    expect(store.getState().contract).toBe(s.contract);
  });

  it('opens broken JSON straight into raw mode with no contract', async () => {
    const { store, ctrl } = setup({}, '{ "schemaVersion": 1, ');
    await ctrl.openPath(FILE);
    expect(store.getState().rawMode).toBe(true);
    expect(store.getState().contract).toBeNull();
    expect(store.getState().loadedInvalid).toBe(true);
  });

  it('derives the inspected commit from the evidence context', async () => {
    const s0 = initialState();
    expect(inspectedCommit(s0)).toBeNull();
    const s1 = reducer(s0, { type: 'setEvidence', ctx: { kind: 'rev', label: 'v1', commit: SHA1 } });
    expect(inspectedCommit(s1)).toBe(SHA1);
    const s2 = reducer(s1, { type: 'setEvidence', ctx: { kind: 'head' } });
    expect(inspectedCommit(s2)).toBeNull(); // no git context
    const s3 = reducer(s2, { type: 'setGit', git: { available: true, headCommit: SHA1 }, refs: [] });
    expect(inspectedCommit(s3)).toBe(SHA1);
  });

  it('selecting an entity switches to the matching view', () => {
    let s = initialState();
    s = reducer(s, { type: 'selectEntity', id: 'sys.x', kind: 'system' });
    expect(s.view).toBe('engineering');
    expect(s.selected.system).toBe('sys.x');
    s = reducer(s, { type: 'setView', view: 'impact' });
    s = reducer(s, { type: 'selectEntity', id: 'cap.y', kind: 'capability' });
    expect(s.view).toBe('product');
  });
});

describe('saving', () => {
  it('writes canonical JSON with the expected sha and becomes clean', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    const before = store.getState().diskSha;
    store.dispatch({ type: 'edit', fn: rename('Saved Name') });
    await ctrl.save();
    const s = store.getState();
    expect(host.writes).toHaveLength(1);
    expect(isDirty(s)).toBe(false);
    expect(s.diskSha).not.toBe(before);
    const written = parseContract(host.getFile(FILE)!);
    expect(written.ok).toBe(true);
    expect(written.contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Saved Name');
  });

  it('skips the write when nothing changed', async () => {
    const { ctrl, host } = setup();
    await ctrl.openPath(FILE);
    await ctrl.save();
    expect(host.writes).toHaveLength(0);
  });

  it('never overwrites a file that changed on disk (conflict prompt)', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('Mine') });
    const external = TASKY.replace('"Task Management"', '"Theirs"');
    await host.externalWrite(FILE, external);
    await ctrl.save();
    expect(store.getState().prompt?.type).toBe('conflict');
    expect(host.writes).toHaveLength(0);
    expect(host.getFile(FILE)).toBe(external);
    expect(isDirty(store.getState())).toBe(true);
  });

  it('Save As writes to the chosen path and rebinds the document', async () => {
    const { store, ctrl, host } = setup({ savePicks: ['/work/repo/copy.orbit.json'] });
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('Copy') });
    await ctrl.saveAs();
    expect(store.getState().filePath).toBe('/work/repo/copy.orbit.json');
    expect(host.getFile('/work/repo/copy.orbit.json')).toContain('"Copy"');
    expect(host.getFile(FILE)).toBe(TASKY);
    expect(isDirty(store.getState())).toBe(false);
  });

  it('Save As cancelled does nothing', async () => {
    const { store, ctrl, host } = setup({ savePicks: [null] });
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('Copy') });
    await ctrl.saveAs();
    expect(host.writes).toHaveLength(0);
    expect(isDirty(store.getState())).toBe(true);
  });
});

describe('raw JSON drafts', () => {
  it('asks before saving errors and writes the exact text only when told to', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    const broken = TASKY.replace('"kind": "capability"', '"kind": "wizard"');
    store.dispatch({ type: 'setRawDraft', text: broken });
    expect(isDirty(store.getState())).toBe(true);
    await ctrl.save();
    expect(store.getState().prompt?.type).toBe('saveErrors');
    expect(host.writes).toHaveLength(0);
    await ctrl.save({ anyway: true });
    expect(host.getFile(FILE)).toBe(broken); // exact text, never a reconstruction
    expect(store.getState().loadedInvalid).toBe(true);
  });

  it('applyRaw with errors keeps the draft and does not change the working contract', async () => {
    const { store, ctrl } = setup();
    await ctrl.openPath(FILE);
    const before = store.getState().contract;
    store.dispatch({ type: 'setRawDraft', text: '{ nope' });
    expect(ctrl.applyRaw()).toBe(false);
    expect(store.getState().rawDraft).toBe('{ nope');
    expect(store.getState().contract).toBe(before);
  });

  it('valid unapplied raw edits require apply-first when saving', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'setRawDraft', text: TASKY.replace('"Task Management"', '"From Raw"') });
    await ctrl.save();
    expect(store.getState().prompt?.type).toBe('applyRawBeforeSave');
    expect(host.writes).toHaveLength(0);
    await ctrl.save({ applyRaw: true });
    expect(host.writes).toHaveLength(1);
    expect(parseContract(host.getFile(FILE)!).contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('From Raw');
    expect(store.getState().rawDraft).toBeNull();
  });

  it('applying a valid raw edit to an invalid-on-load file makes it editable', async () => {
    const { store, ctrl } = setup({}, INVALID);
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'setRawDraft', text: TASKY });
    expect(ctrl.applyRaw()).toBe(true);
    const s = store.getState();
    expect(s.loadedInvalid).toBe(false);
    expect(isDirty(s)).toBe(true); // differs from what is on disk
  });
});

describe('external changes', () => {
  it('reloads automatically when clean', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    await host.externalWrite(FILE, TASKY.replace('"Task Management"', '"Changed Elsewhere"'));
    await ctrl.poll();
    expect(store.getState().contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Changed Elsewhere');
    expect(store.getState().toasts.some((t) => t.message.includes('Reloaded'))).toBe(true);
  });

  it('keeps unsaved edits and raises a banner when dirty', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    store.dispatch({ type: 'edit', fn: rename('Mine') });
    await host.externalWrite(FILE, TASKY.replace('"Task Management"', '"Theirs"'));
    await ctrl.poll();
    const s = store.getState();
    expect(s.externalChange?.kind).toBe('modified');
    expect(s.contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Mine');
  });

  it('detects deletion and recreates on save with null expectation', async () => {
    const { store, ctrl, host } = setup();
    await ctrl.openPath(FILE);
    host.externalDelete(FILE);
    await ctrl.poll();
    expect(store.getState().externalChange?.kind).toBe('deleted');
    store.dispatch({ type: 'edit', fn: rename('Recreated') });
    await ctrl.save();
    expect(host.getFile(FILE)).toContain('Recreated');
    expect(store.getState().externalChange).toBeNull();
  });
});

describe('create new', () => {
  it('writes a schema-valid empty contract and opens it', async () => {
    const { store, ctrl, host } = setup({ savePicks: ['/work/new/shop.orbit.json'] });
    const ok = await ctrl.createNew({ id: 'shop', name: 'Shop', summary: 'A shop' });
    expect(ok).toBe(true);
    const parsed = parseContract(host.getFile('/work/new/shop.orbit.json')!);
    expect(parsed.ok).toBe(true);
    expect(parsed.contract).toMatchObject({ schemaVersion: 1, product: { id: 'shop', name: 'Shop' }, entities: [], relationships: [], tests: [], evidence: [] });
    expect(store.getState().filePath).toBe('/work/new/shop.orbit.json');
  });

  it('refuses to overwrite an existing file', async () => {
    const { ctrl, host } = setup({ savePicks: [FILE] });
    const ok = await ctrl.createNew({ id: 'x', name: 'X', summary: 'x' });
    expect(ok).toBe(false);
    expect(host.getFile(FILE)).toBe(TASKY);
  });
});
