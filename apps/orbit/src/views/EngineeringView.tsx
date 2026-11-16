import { Tabs } from '@radix-ui/themes';
import { useApp, useDispatch } from '../state/context';
import { ArchitectureView } from './ArchitectureView';
import { ExplorerView } from './ExplorerView';

export function EngineeringView() {
  const tab = useApp((state) => state.engineeringTab);
  const dispatch = useDispatch();

  return (
    <Tabs.Root className="engineering-view" value={tab} onValueChange={(value) => {
      if (value === 'systems' || value === 'architecture') dispatch({ type: 'setEngineeringTab', tab: value });
    }}>
      <Tabs.List size="1" aria-label="System views" className="engineering-tabs">
        <Tabs.Trigger value="systems">Systems</Tabs.Trigger>
        <Tabs.Trigger value="architecture">Overview</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="systems" className="engineering-tab-content" forceMount hidden={tab !== 'systems'}>
        <ExplorerView kind="system" />
      </Tabs.Content>
      <Tabs.Content value="architecture" className="engineering-tab-content" forceMount hidden={tab !== 'architecture'}>
        <ArchitectureView active={tab === 'architecture'} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
