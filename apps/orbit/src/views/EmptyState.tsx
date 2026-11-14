import { Button, Code, Flex, Heading, IconButton, Text } from '@radix-ui/themes';
import { Cross2Icon, FileTextIcon } from '@radix-ui/react-icons';
import { fileName } from '../lib/format';
import { removeRecent } from '../lib/prefs';
import { OrbitMark } from '../components/TopBar';
import { useApp, useCtrl, useDispatch } from '../state/context';

export function EmptyState() {
  const ctrl = useCtrl();
  const d = useDispatch();
  const recent = useApp((s) => s.recent);
  return (
    <main className="empty-state" aria-label="No contract open">
      <div className="empty-card">
        <div className="empty-mark">
          <OrbitMark size={44} />
        </div>
        <Heading size="6" mb="2">
          Orbit
        </Heading>
        <Text as="p" size="3" color="gray" mb="5">
          Model what your product does, see how well it is verified, and understand what a change affects — all from one JSON file.
        </Text>
        <Flex gap="3" justify="center" mb="6">
          <Button size="3" onClick={() => void ctrl.openDialog()}>
            Open contract…
          </Button>
          <Button size="3" variant="soft" onClick={() => d({ type: 'ui', patch: { newDialog: true } })}>
            Create new contract
          </Button>
        </Flex>
        {recent.length > 0 && (
          <section aria-label="Recent files" className="recent">
            <Text as="div" size="1" weight="bold" color="gray" mb="2" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Recent
            </Text>
            <ul>
              {recent.map((p) => (
                <li key={p}>
                  <Button variant="ghost" color="gray" className="recent-open" onClick={() => void ctrl.openPath(p)} aria-label={`Open ${fileName(p)}`}>
                    <FileTextIcon aria-hidden />
                    <span className="recent-name">{fileName(p)}</span>
                    <span className="recent-path truncate">{p}</span>
                  </Button>
                  <IconButton size="1" variant="ghost" color="gray" aria-label={`Remove ${fileName(p)} from recent files`} onClick={() => d({ type: 'setRecent', recent: removeRecent(p) })}>
                    <Cross2Icon />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Text as="p" size="2" color="gray" mt="5">
          New here? Open <Code size="2">examples/tasky.orbit.json</Code> from this repository to explore a complete sample contract.
        </Text>
      </div>
    </main>
  );
}

export function NotDesktop() {
  return (
    <main className="empty-state" aria-label="Desktop app required">
      <div className="empty-card">
        <div className="empty-mark">
          <OrbitMark size={44} />
        </div>
        <Heading size="6" mb="2">
          Orbit runs as a desktop app
        </Heading>
        <Text as="p" size="3" color="gray" mb="3">
          Orbit needs to open local files and read Git history, which a browser tab cannot do.
        </Text>
        <Text as="p" size="3">
          Start it with <Code size="3">npm run orbit</Code>
        </Text>
      </div>
    </main>
  );
}
