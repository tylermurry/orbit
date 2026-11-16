import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DropdownMenu } from '@radix-ui/themes';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { fileName } from '../lib/format';
import { useApp, useCtrl, useDispatch, useHost } from '../state/context';

function projectLabel(path: string): string {
  const name = fileName(path);
  if (name === 'orbit.json') {
    const segments = path.split(/[\\/]/).filter(Boolean);
    return segments.at(-2) ?? name;
  }
  return name.replace(/\.orbit\.json$/i, '') || name;
}

export function ProjectSwitcher() {
  const path = useApp((s) => s.filePath);
  const productName = useApp((s) => s.contract?.product.name);
  const recent = useApp((s) => s.recent);
  const host = useHost();
  const ctrl = useCtrl();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState(() => new Map<string, string>());
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOffset, setMenuOffset] = useState({ sideOffset: 0, alignOffset: 0 });

  useLayoutEffect(() => {
    const button = trigger.current;
    const toolbar = button?.closest('.topbar');
    if (!open || !button || !toolbar) return;

    const alignMenu = () => {
      const bar = toolbar.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      setMenuOffset({ sideOffset: bar.bottom - anchor.bottom, alignOffset: bar.left - anchor.left });
    };
    alignMenu();
    const observer = new ResizeObserver(alignMenu);
    observer.observe(toolbar);
    observer.observe(button);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const readNames = async () => {
      const entries = await Promise.allSettled(recent.filter((file) => file !== path).map(async (file) => {
        const { text } = await host.readFile(file);
        const project = JSON.parse(text) as { product?: { name?: unknown } } | null;
        const name = project?.product?.name;
        return [file, typeof name === 'string' && name.trim() ? name : projectLabel(file)] as const;
      }));
      if (active) setNames(new Map(entries.flatMap((entry) => entry.status === 'fulfilled' ? [entry.value] : [])));
    };
    void readNames();
    return () => { active = false; };
  }, [open, recent, path, host]);

  if (!path && !recent.length) return <span className="product-name static">Orbit</span>;

  const label = productName ?? (path ? 'Invalid contract' : 'Orbit');
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger>
        <button ref={trigger} type="button" className="product-name project-switcher" aria-label={`Switch project (${label})`} title={label}>
          <span className="truncate">{label}</span>
          <ChevronDownIcon aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content className="project-switcher-menu" side="bottom" align="start" collisionPadding={{ left: 0, right: 10, bottom: 10 }} {...menuOffset}>
        <DropdownMenu.Item disabled={!productName} onSelect={() => dispatch({ type: 'ui', patch: { productDialog: true } })}>
          Product Settings
        </DropdownMenu.Item>
        {recent.length > 0 && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Label>Recent Projects</DropdownMenu.Label>
            <DropdownMenu.RadioGroup value={path ?? ''} onValueChange={(next) => {
              if (next !== path) ctrl.guard('Switching projects', () => void ctrl.openPath(next));
            }}>
              {recent.map((file) => {
                const name = file === path && productName ? productName : names.get(file) ?? projectLabel(file);
                return (
                  <DropdownMenu.RadioItem key={file} value={file} textValue={name} className="project-switcher-item">
                    <span className="project-switcher-project">
                      <span className="truncate">{name}</span>
                      <span className="project-switcher-path truncate" title={file}>{file}</span>
                    </span>
                  </DropdownMenu.RadioItem>
                );
              })}
            </DropdownMenu.RadioGroup>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
