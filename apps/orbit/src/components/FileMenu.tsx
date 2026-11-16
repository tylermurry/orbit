import { useEffect, useRef } from 'react';
import { Button, DropdownMenu, Text } from '@radix-ui/themes';
import { fileName } from '../lib/format';
import { useAppState, useCtrl, useDispatch, useHost, useStore } from '../state/context';
import { isDirty } from '../state/store';
import { useProjectSkills } from './ProjectSkills';

export function FileMenu() {
  const state = useAppState();
  const store = useStore();
  const ctrl = useCtrl();
  const dispatch = useDispatch();
  const native = useHost().kind === 'tauri';
  const skills = useProjectSkills();
  const hasFile = !!state.filePath && (!!state.contract || state.loadedInvalid);
  const hasContract = !!state.contract;
  const dirty = isDirty(state);
  const skillsAvailable = !!skills?.available;
  const { recent } = state;

  function select(action: string) {
    const current = store.getState();
    switch (action) {
      case 'new':
        ctrl.guard('Creating a new contract', () => dispatch({ type: 'ui', patch: { newDialog: true } }));
        break;
      case 'open': void ctrl.openDialog(); break;
      case 'save': if (current.filePath && isDirty(current)) void ctrl.save(); break;
      case 'save-as': if (current.filePath) void ctrl.saveAs(); break;
      case 'reload':
        if (!current.filePath) break;
        if (isDirty(current)) dispatch({ type: 'prompt', prompt: { type: 'reload' } });
        else void ctrl.reloadFromDisk();
        break;
      case 'product-settings': if (current.contract) dispatch({ type: 'ui', patch: { productDialog: true } }); break;
      case 'skills': skills?.openManager(); break;
      case 'shortcuts': dispatch({ type: 'ui', patch: { shortcutsOpen: true } }); break;
      default: {
        if (!action.startsWith('recent:')) break;
        const path = action.slice('recent:'.length);
        if (current.recent.includes(path)) ctrl.guard('Opening another file', () => void ctrl.openPath(path));
      }
    }
  }

  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    if (!native) return;
    let active = true;
    const subscription = import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('orbit:file-menu', ({ payload }) => { if (active) selectRef.current(payload); }),
    );
    void subscription.catch((error: unknown) => console.error('Could not listen to the File menu', error));
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten(), () => undefined);
    };
  }, [native]);

  useEffect(() => {
    if (!native) return;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('update_file_menu', { state: { hasFile, dirty, hasContract, skillsAvailable, recent } }))
      .catch((error: unknown) => console.error('Could not update the File menu', error));
  }, [native, hasFile, dirty, hasContract, skillsAvailable, recent]);

  if (native) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger><Button size="2" color="gray" variant="ghost">File</Button></DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <DropdownMenu.Item onSelect={() => select('new')}>New…</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => select('open')}>Open…</DropdownMenu.Item>
        <DropdownMenu.Sub>
          <DropdownMenu.SubTrigger>Recent Files</DropdownMenu.SubTrigger>
          <DropdownMenu.SubContent>
            {recent.length === 0 && <DropdownMenu.Item disabled>No recent files</DropdownMenu.Item>}
            {recent.map((path) => (
              <DropdownMenu.Item key={path} onSelect={() => select(`recent:${path}`)}>
                {fileName(path)} <Text size="1" color="gray" ml="2">{path}</Text>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Sub>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => select('save')} disabled={!hasFile || !dirty}>Save</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => select('save-as')} disabled={!hasFile}>Save As…</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => select('reload')} disabled={!hasFile}>Reload from Disk</DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => select('product-settings')} disabled={!hasContract}>Product Settings…</DropdownMenu.Item>
        {skillsAvailable && <DropdownMenu.Item onSelect={() => select('skills')} disabled={!hasFile}>Install/Update Skills…</DropdownMenu.Item>}
        <DropdownMenu.Item onSelect={() => select('shortcuts')}>Keyboard Shortcuts</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
