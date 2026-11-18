import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog, Flex, Text } from '@radix-ui/themes';
import type { SkillStatus } from '../host/types';
import { useApp, useCtrl, useHost, useStore } from '../state/context';

interface SkillsActions {
  available: boolean;
  primary: 'Install Skills' | 'Update Skills' | null;
  openManager: () => void;
  runPrimary: () => void;
  installForNewProject: () => Promise<void>;
}

const SkillsContext = createContext<SkillsActions | null>(null);

export function useProjectSkills() {
  return useContext(SkillsContext);
}

type Check = { path: string; status?: SkillStatus; error?: string };
const label = (s: SkillStatus) => s.action === 'install' ? 'Install Skills' : 'Update Skills';

export function ProjectSkills({ children }: { children: ReactNode }) {
  const host = useHost();
  const ctrl = useCtrl();
  const store = useStore();
  const path = useApp((s) => s.filePath);
  const [check, setCheck] = useState<Check>();
  const [managerPath, setManagerPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(0);
  const available = !!host.skillsStatus && !!host.installSkills;

  const refresh = useCallback(async (file: string) => {
    const id = ++operation.current;
    const publish = (value: Check) => {
      if (operation.current === id) setCheck(value);
    };
    try {
      const status = await host.skillsStatus!(file);
      publish({ path: file, status });
    } catch (error) {
      publish({ path: file, error: (error as Error).message });
    }
  }, [host]);

  useEffect(() => {
    if (path && available) void refresh(path);
  }, [available, path, refresh]);

  async function apply(file: string, status: SkillStatus, replaceCustom: boolean) {
    setBusy(true);
    const id = ++operation.current;
    try {
      const next = await host.installSkills!(file, status, replaceCustom);
      if (operation.current === id) setCheck({ path: file, status: next });
      ctrl.toast(status.action === 'install' ? 'Installed Claude Code skills' : 'Updated Claude Code skills', 'success');
      setManagerPath((open) => open === file ? null : open);
    } catch (error) {
      ctrl.toast((error as Error).message, 'error');
      if (operation.current === id && store.getState().filePath === file) await refresh(file);
    } finally {
      setBusy(false);
    }
  }

  async function installForNewProject() {
    const file = store.getState().filePath;
    if (!available || !file) return;
    try {
      const status = await host.skillsStatus!(file);
      if (store.getState().filePath === file && status.action === 'install') await apply(file, status, false);
    } catch (error) {
      ctrl.toast((error as Error).message, 'error');
    }
  }

  function openManager() {
    if (!path || !available) return;
    setManagerPath(path);
    setCheck(undefined);
    void refresh(path);
  }

  const checked = check?.path === path ? check : undefined;
  const status = checked?.status;
  const canInstall = status?.action === 'install' || status?.action === 'update';
  const customized = status?.action === 'update' ? status.customized : [];
  const primary = canInstall ? label(status) : null;
  function runPrimary() {
    if (!path || !canInstall || busy) return;
    if (customized.length) openManager();
    else void apply(path, status, false);
  }

  return (
    <SkillsContext.Provider value={{ available, primary: busy ? null : primary, openManager, runPrimary, installForNewProject }}>
      {children}
      <Dialog.Root open={!!path && managerPath === path} onOpenChange={(open) => { if (!open && !busy) setManagerPath(null); }}>
        <Dialog.Content maxWidth="440px">
          <Dialog.Title>{primary ?? 'Orbit skills'}</Dialog.Title>
          <Dialog.Description size="2" color="gray" mb="3">
            Manage /orbit-plan, /orbit-implement and /orbit-sync in this project’s .claude/skills folder.
          </Dialog.Description>
          {!checked && <Text as="p" size="2">Checking skills…</Text>}
          {checked?.error && <Text as="p" size="2" color="red">{checked.error}</Text>}
          {status?.notice && <Text as="p" size="2" color="amber">{status.notice}</Text>}
          {status?.action === 'current' && <Text as="p" size="2">Skills are up to date.</Text>}
          {customized.length > 0 && <Text as="p" size="2">Replace the local edits in {customized.join(', ')}?</Text>}
          <Flex gap="2" mt="4" justify="end">
            <Button variant="soft" color="gray" disabled={busy} onClick={() => setManagerPath(null)}>{canInstall ? 'Cancel' : 'Close'}</Button>
            {path && (checked?.error || status?.notice) && <Button variant="soft" disabled={busy} onClick={() => { setCheck(undefined); void refresh(path); }}>Retry</Button>}
            {path && canInstall && <Button disabled={busy} onClick={() => void apply(path, status, customized.length > 0)}>{customized.length ? 'Replace and update' : primary}</Button>}
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </SkillsContext.Provider>
  );
}
