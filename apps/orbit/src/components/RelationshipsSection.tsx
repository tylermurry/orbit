import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  IconButton,
  SegmentedControl,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  Pencil1Icon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { allIds, focusedRelations, generateId } from "@orbit/contract";
import type {
  Entity,
  OrbitContract,
  Relationship,
  RelationshipType,
} from "@orbit/contract";
import { REL_INFO } from "../lib/model";
import { useCtrl, useDispatch, useEdit } from "../state/context";
import { Confirm, EntityLink } from "./common";
import { RelationshipGraph } from "./RelationshipGraph";
import { Field } from "./Dialogs";
import { EntityPicker } from "./EntityPicker";

const TYPES: RelationshipType[] = ["dependsOn", "uses", "implementedBy"];
const GROUP_TITLE: Record<RelationshipType, string> = {
  dependsOn: "Depends On",
  uses: "Uses",
  implementedBy: "Implemented By",
};

export function RelationshipDialog({
  open,
  onOpenChange,
  contract,
  entity,
  relationship,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: OrbitContract;
  entity: Entity;
  relationship: Relationship | null;
}) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const [direction, setDirection] = useState<"source" | "target">("source");
  const [type, setType] = useState<RelationshipType>("dependsOn");
  const [otherId, setOtherId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (!open) return;
    if (relationship) {
      const isSource = relationship.sourceId === entity.id;
      setDirection(isSource ? "source" : "target");
      setType(relationship.type);
      setOtherId(isSource ? relationship.targetId : relationship.sourceId);
      setDescription(relationship.description ?? "");
    } else {
      setDirection("source");
      setType("dependsOn");
      setOtherId(null);
      setDescription("");
    }
  }, [open, relationship, entity.id]);
  const other = otherId
    ? contract.entities.find((e) => e.id === otherId)
    : undefined;
  const sourceId = direction === "source" ? entity.id : otherId;
  const targetId = direction === "source" ? otherId : entity.id;
  const sourceName =
    direction === "source" ? entity.name : (other?.name ?? "…");
  const targetName =
    direction === "source" ? (other?.name ?? "…") : entity.name;
  const duplicate = !!(
    sourceId &&
    targetId &&
    contract.relationships.some(
      (r) =>
        r.id !== relationship?.id &&
        r.type === type &&
        r.sourceId === sourceId &&
        r.targetId === targetId,
    )
  );
  const allow = useMemo(() => (e: Entity) => e.id !== entity.id, [entity.id]);
  const submit = () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const desc = description.trim();
    edit((c) => {
      if (relationship) {
        return {
          ...c,
          relationships: c.relationships.map((r) =>
            r.id === relationship.id
              ? {
                  id: r.id,
                  type,
                  sourceId,
                  targetId,
                  ...(desc ? { description: desc } : {}),
                }
              : r,
          ),
        };
      }
      const srcN = c.entities.find((e) => e.id === sourceId)?.name ?? "";
      const tgtN = c.entities.find((e) => e.id === targetId)?.name ?? "";
      const id = generateId(
        "rel",
        allIds(c).relationships,
        `${srcN} ${type} ${tgtN}`,
      );
      return {
        ...c,
        relationships: [
          ...c.relationships,
          {
            id,
            type,
            sourceId,
            targetId,
            ...(desc ? { description: desc } : {}),
          },
        ],
      };
    });
    onOpenChange(false);
    ctrl.toast(
      relationship ? "Relationship updated" : "Relationship added",
      "success",
    );
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>
          {relationship ? "Edit relationship" : "Add relationship"}
        </Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Relationships point from a source to a target. Impact flows backwards:
          if the target changes, the source is potentially affected.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="3">
            <div>
              <Text as="div" size="2" weight="medium" mb="1">
                Direction
              </Text>
              <SegmentedControl.Root
                value={direction}
                onValueChange={(v) => setDirection(v as "source" | "target")}
                aria-label="Direction"
              >
                <SegmentedControl.Item value="source">
                  This entity is the source
                </SegmentedControl.Item>
                <SegmentedControl.Item value="target">
                  This entity is the target
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>
            <Field label="Type">
              <Select.Root
                value={type}
                onValueChange={(v) => setType(v as RelationshipType)}
              >
                <Select.Trigger
                  aria-label="Relationship type"
                  style={{ width: "100%" }}
                />
                <Select.Content>
                  {TYPES.map((t) => (
                    <Select.Item key={t} value={t}>
                      {t} — {REL_INFO[t].verb}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Text as="div" size="1" color="gray" mt="1">
                {REL_INFO[type].meaning}
              </Text>
            </Field>
            <div>
              <Text as="div" size="2" weight="medium" mb="1">
                {direction === "source" ? "Target entity" : "Source entity"}
              </Text>
              <EntityPicker
                contract={contract}
                value={otherId}
                onChange={setOtherId}
                allow={allow}
                label={
                  direction === "source" ? "Target entity" : "Source entity"
                }
                showKind
                triggerWidth="100%"
              />
            </div>
            <Field label="Description (optional)">
              <TextField.Root
                aria-label="Relationship description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Why does this relationship exist?"
              />
            </Field>
            <div
              className="preview-sentence"
              aria-live="polite"
              data-testid="rel-preview"
            >
              <Text size="1" color="gray" as="div" mb="1">
                Preview
              </Text>
              <Text size="3">
                {sourceName} <strong>{REL_INFO[type].verb}</strong> {targetName}
              </Text>
            </div>
            {duplicate && (
              <Callout.Root color="amber" size="1" variant="surface">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  An identical relationship already exists. Adding it again
                  creates a duplicate edge.
                </Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!otherId}>
              {relationship ? "Save relationship" : "Add relationship"}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function RelationshipsSection({
  contract,
  entity,
  readOnly,
}: {
  contract: OrbitContract;
  entity: Entity;
  readOnly: boolean;
}) {
  const d = useDispatch();
  const edit = useEdit();
  const ctrl = useCtrl();
  const { incoming, outgoing } = useMemo(
    () => focusedRelations(contract, entity.id),
    [contract, entity.id],
  );
  const [dialog, setDialog] = useState<{ rel: Relationship | null } | null>(
    null,
  );
  const [del, setDel] = useState<Relationship | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const name = (id: string) =>
    contract.entities.find((e) => e.id === id)?.name ?? id;

  const rows = [
    ...outgoing.map((r) => ({ r, dir: "out" as const })),
    ...incoming.map((r) => ({ r, dir: "in" as const })),
  ];

  const Row = ({ r, dir }: { r: Relationship; dir: "out" | "in" }) => {
    const label = `${name(r.sourceId)} ${REL_INFO[r.type].verb} ${name(r.targetId)}`;
    return (
      <li className="rel-row" data-testid="rel-row" data-rel-id={r.id}>
        <Flex align="start" gap="2" className="rel-sentence">
          {dir === "out" ? (
            <EntityLink id={r.targetId} />
          ) : (
            <EntityLink id={r.sourceId} />
          )}
          {!readOnly && (
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              className="rel-edit"
              aria-label={`Edit relationship: ${label}`}
              onClick={() => setDialog({ rel: r })}
            >
              <Pencil1Icon />
            </IconButton>
          )}
        </Flex>
        {!readOnly && (
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            className="rel-delete"
            aria-label={`Delete relationship: ${label}`}
            onClick={() => setDel(r)}
          >
            <TrashIcon />
          </IconButton>
        )}
        {r.description && (
          <Text as="div" size="2" color="gray" className="rel-desc">
            {r.description}
          </Text>
        )}
        <span className="sr-only">{label}</span>
      </li>
    );
  };

  if (incoming.length + outgoing.length === 0) {
    return readOnly ? null : (
      <>
        <Button
          size="2"
          variant="soft"
          onClick={() => setDialog({ rel: null })}
          className="add-empty"
        >
          <PlusIcon aria-hidden /> Add relationship
        </Button>
        {dialog && (
          <RelationshipDialog
            open
            onOpenChange={(o) => !o && setDialog(null)}
            contract={contract}
            entity={entity}
            relationship={dialog.rel}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div style={{ marginTop: 28 }}>
        <RelationshipGraph
          contract={contract}
          entityId={entity.id}
          onNavigate={(e) =>
            d({ type: "selectEntity", id: e.id, kind: e.kind })
          }
        />
      </div>
      <section aria-labelledby="sec-rels" className="section">
        <Flex justify="between" align="center" mb="2">
          <h3 id="sec-rels" className="section-title">
            Relationships{" "}
            <Text size="2" color="gray" weight="regular">
              ({incoming.length + outgoing.length})
            </Text>
          </h3>
          {!readOnly && (
            <Button
              size="2"
              variant="soft"
              onClick={() => setDialog({ rel: null })}
            >
              <PlusIcon aria-hidden /> Add relationship
            </Button>
          )}
        </Flex>
        {TYPES.map((ty) => {
          const sub = rows.filter((x) => x.r.type === ty);
          if (!sub.length) return null;
          const isOpen = !collapsed[ty];
          return (
            <div
              key={ty}
              className="rel-group"
              data-testid={`rel-group-${ty}`}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest("button, a"))
                  setCollapsed({ ...collapsed, [ty]: isOpen });
              }}
            >
              <button
                type="button"
                className="rel-group-head"
                aria-expanded={isOpen}
                onClick={() => setCollapsed({ ...collapsed, [ty]: isOpen })}
              >
                {isOpen ? (
                  <ChevronDownIcon aria-hidden />
                ) : (
                  <ChevronRightIcon aria-hidden />
                )}
                <span className="rel-group-title">{GROUP_TITLE[ty]}</span>
              </button>
              {isOpen && (
                <ul className="rel-list">
                  {sub.map(({ r, dir }) => (
                    <Row key={r.id + dir} r={r} dir={dir} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {dialog && (
          <RelationshipDialog
            open
            onOpenChange={(o) => !o && setDialog(null)}
            contract={contract}
            entity={entity}
            relationship={dialog.rel}
          />
        )}
        <Confirm
          open={!!del}
          onOpenChange={(o) => !o && setDel(null)}
          title="Delete relationship?"
          confirmLabel="Delete relationship"
          danger
          onConfirm={() => {
            if (!del) return;
            const id = del.id;
            edit((c) => ({
              ...c,
              relationships: c.relationships.filter((r) => r.id !== id),
            }));
            ctrl.toast("Relationship deleted", "info");
            setDel(null);
          }}
        >
          {del
            ? `${name(del.sourceId)} ${REL_INFO[del.type].verb} ${name(del.targetId)}`
            : ""}
        </Confirm>
      </section>
    </>
  );
}
