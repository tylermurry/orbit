import { useEffect, useState } from 'react';
import { Badge, Button, Callout, Code, Dialog, Flex, IconButton, Switch, Table, Tabs, Text, TextField, Tooltip } from '@radix-ui/themes';
import { CheckIcon, CopyIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { useMcp } from '../mcp/context';
import type { UseMcp } from '../mcp/context';
import type { McpUiState } from '../mcp/runtime';

const PLACEHOLDER_URL = 'http://127.0.0.1:47821/mcp';
const STDIO_PATH = '/path/to/orbit/scripts/orbit-mcp-stdio.mjs';

const STATE_LABEL: Record<McpUiState, string> = { unsupported: 'Desktop only', off: 'Off', ready: 'Ready', active: 'Active', error: 'Error' };

function tooltipFor(m: UseMcp): string {
  switch (m.state) {
    case 'unsupported':
      return 'AI access (MCP) — the server runs in the desktop app';
    case 'off':
      return 'AI access is off';
    case 'error':
      return `AI access error: ${m.status?.error ?? m.statusError ?? 'the server is not running'}`;
    case 'active':
      return `AI is working — ${m.status?.url ?? ''}`;
    default:
      return `AI access ready — ${m.status?.url ?? ''}`;
  }
}

export function AiButton() {
  const m = useMcp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content={tooltipFor(m)}>
        <Button variant="surface" color="gray" size="2" className="topbar-btn ai-btn" aria-label={`AI access: ${STATE_LABEL[m.state]}`} data-testid="ai-button" data-state={m.state} onClick={() => setOpen(true)}>
          <span className="ai-dot" data-state={m.state} aria-hidden />
          AI
        </Button>
      </Tooltip>
      <McpDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* ignore */
      }
      ta.remove();
    }
    setDone(true);
  };
  return (
    <Tooltip content={done ? 'Copied' : label}>
      <IconButton size="1" variant="soft" color={done ? 'green' : 'gray'} aria-label={label} onClick={() => void copy()}>
        {done ? <CheckIcon /> : <CopyIcon />}
      </IconButton>
    </Tooltip>
  );
}

function Snippet({ label, text, display }: { label: string; text: string; display?: string }) {
  return (
    <div className="mcp-snippet">
      <pre tabIndex={0} aria-label={label}>
        <code>{display ?? text}</code>
      </pre>
      <div className="mcp-snippet-copy">
        <CopyButton text={text} label={`Copy ${label}`} />
      </div>
    </div>
  );
}

function StatusBadge({ m }: { m: UseMcp }) {
  const color = m.state === 'error' ? 'red' : m.state === 'off' || m.state === 'unsupported' ? 'gray' : 'green';
  const text = m.state === 'ready' ? 'Running' : m.state === 'active' ? 'Active' : m.state === 'off' ? 'Stopped' : m.state === 'unsupported' ? 'Desktop only' : 'Error';
  return (
    <Badge color={color} variant="soft" radius="full" data-testid="mcp-status">
      <span className="ai-dot" data-state={m.state} aria-hidden />
      {text}
    </Badge>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false });

export function McpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const m = useMcp();
  const [busy, setBusy] = useState(false);

  const desktop = m.supported;
  const url = m.status?.url ?? PLACEHOLDER_URL;
  const claudeCode = `claude mcp add --transport http orbit ${url}`;
  const jsonConfig = JSON.stringify({ mcpServers: { orbit: { type: 'http', url } } }, null, 2);
  const stdioCmd = `ORBIT_MCP_URL=${url} node ${STDIO_PATH}`;
  const stdioJson = JSON.stringify({ mcpServers: { orbit: { command: 'node', args: [STDIO_PATH], env: { ORBIT_MCP_URL: url } } } }, null, 2);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="680px" aria-describedby={undefined} data-testid="mcp-dialog">
        <Dialog.Title>AI access (MCP)</Dialog.Title>
        <Text as="p" size="2" color="gray" mb="3">
          Let AI assistants such as Claude Code, Claude Desktop or Cursor take the same actions you can, through Orbit’s built-in MCP server. AI edits are in-memory and undoable until you save, with the same safeguards as manual editing.
        </Text>

        {!desktop && (
          <Callout.Root color="blue" size="1" mb="3" data-testid="mcp-desktop-only">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              <strong>MCP server runs in the desktop app.</strong> Open Orbit as a desktop app to enable AI access; the snippets below show what you will paste into your AI client.
            </Callout.Text>
          </Callout.Root>
        )}

        <Flex align="center" justify="between" gap="3" mb="3" className="mcp-row">
          <Text as="label" size="2" weight="medium">
            <Flex align="center" gap="2">
              <Switch
                aria-label="Allow AI assistants to connect"
                checked={desktop ? !!m.status?.enabled : false}
                disabled={!desktop || busy}
                onCheckedChange={(v) => {
                  setBusy(true);
                  void m.runtime.setEnabled(v).finally(() => setBusy(false));
                }}
              />
              Allow AI assistants to connect
            </Flex>
          </Text>
          <StatusBadge m={m} />
        </Flex>

        {desktop && (m.status?.error || m.statusError) && (
          <Callout.Root color="red" size="1" mb="3" role="alert">
            <Callout.Text>{m.status?.error ?? m.statusError}</Callout.Text>
          </Callout.Root>
        )}

        <Flex direction="column" gap="2" mb="3">
          <Flex align="center" gap="2">
            <Text size="2" weight="medium" style={{ width: 72 }}>
              Endpoint
            </Text>
            <TextField.Root readOnly aria-label="Endpoint URL" value={url} style={{ flex: 1, fontFamily: 'var(--code-font-family)' }} />
            <CopyButton text={url} label="Copy endpoint URL" />
          </Flex>
          <Text size="1" color="gray">
            The server only listens on 127.0.0.1 and requests from web pages are rejected. No token is required.
          </Text>
        </Flex>

        <Tabs.Root defaultValue="claude-code">
          <Tabs.List size="1">
            <Tabs.Trigger value="claude-code">Claude Code</Tabs.Trigger>
            <Tabs.Trigger value="json">JSON config</Tabs.Trigger>
            <Tabs.Trigger value="stdio">stdio bridge</Tabs.Trigger>
          </Tabs.List>
          <Flex direction="column" gap="2" pt="3">
            <Tabs.Content value="claude-code">
              <Text as="p" size="1" color="gray" mb="2">
                Run once in a terminal:
              </Text>
              <Snippet label="Claude Code command" text={claudeCode} display={claudeCode} />
            </Tabs.Content>
            <Tabs.Content value="json">
              <Text as="p" size="1" color="gray" mb="2">
                For Cursor and other clients that speak HTTP MCP, add to their MCP config:
              </Text>
              <Snippet label="JSON config" text={jsonConfig} display={jsonConfig} />
            </Tabs.Content>
            <Tabs.Content value="stdio">
              <Text as="p" size="1" color="gray" mb="2">
                For clients that only speak stdio (e.g. Claude Desktop), use the dependency-free bridge (Node 18+) from the Orbit repository:
              </Text>
              <Snippet label="stdio bridge command" text={stdioCmd} display={stdioCmd} />
              <Text as="p" size="1" color="gray" my="2">
                Claude Desktop config:
              </Text>
              <Snippet label="Claude Desktop config" text={stdioJson} display={stdioJson} />
            </Tabs.Content>
          </Flex>
        </Tabs.Root>

        <Text as="div" size="2" weight="medium" mt="4" mb="2">
          Recent activity
        </Text>
        <div className="mcp-activity" data-testid="mcp-activity">
          {m.activity.length === 0 ? (
            <Text size="2" color="gray">
              No AI requests yet. {m.toolCount} tools are available.
            </Text>
          ) : (
            <Table.Root size="1" variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Tool</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Result</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Summary</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {m.activity.slice(0, 20).map((a) => (
                  <Table.Row key={a.id} data-testid="mcp-activity-row">
                    <Table.Cell>
                      <Text size="1" color="gray">
                        {time(a.at)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Code size="1">{a.tool}</Code>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge size="1" variant="soft" color={a.ok ? (a.mutated ? 'indigo' : 'gray') : 'red'}>
                        {a.ok ? (a.mutated ? 'Changed' : 'OK') : 'Error'}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="mcp-summary">
                      <Text size="1">{a.summary}</Text>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </div>

        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
