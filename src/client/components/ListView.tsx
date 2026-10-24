import { memo, useCallback, useState } from "react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft, ChevronRight, Plus } from "lucide-react";
import { columnIcon } from "../../shared/column-icons";
import type { Card, Column, Doc, Op } from "../../shared/types";
import { newId } from "../../shared/validate";
import { useReadOnly } from "../lib/readonly";
import { DROP_ANIMATION, useCardDnd } from "../lib/useCardDnd";
import { Composer } from "./Column";
import { PRIORITY_LABEL, PriorityIcon, StatusIcon, timeAgo } from "./ui";

/** Every card as a row, grouped into collapsible sections by status (column). */
export function ListView({
  projectId,
  doc,
  dispatch,
  onOpenCard,
}: {
  projectId: string;
  doc: Doc;
  dispatch: (op: Op) => void;
  onOpenCard: (id: string) => void;
}) {
  const { items, activeCard, contextProps } = useCardDnd(doc, dispatch);
  const [collapsed, toggle] = useCollapsedSections(projectId);

  return (
    <DndContext {...contextProps}>
      <div className="list-view">
        {doc.columns.map((column) => (
          <ListSection
            key={column.id}
            column={column}
            cardIds={items[column.id] ?? column.cardIds}
            cards={doc.cards}
            collapsed={collapsed.has(column.id)}
            onToggle={toggle}
            dispatch={dispatch}
            onOpenCard={onOpenCard}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeCard ? <ListRowContent card={activeCard} className="list-row is-overlay" /> : null}
      </DragOverlay>
    </DndContext>
  );
}

const ListSection = memo(function ListSection({
  column,
  cardIds,
  cards,
  collapsed,
  onToggle,
  dispatch,
  onOpenCard,
}: {
  column: Column;
  cardIds: string[];
  cards: Record<string, Card>;
  collapsed: boolean;
  onToggle: (columnId: string, open?: boolean) => void;
  dispatch: (op: Op) => void;
  onOpenCard: (id: string) => void;
}) {
  // The whole section, header included, accepts drops, so cards can be dragged
  // onto a collapsed section.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [composing, setComposing] = useState(false);
  const readOnly = useReadOnly();
  const visible = cardIds.filter((id) => cards[id]);
  const bodyId = `list-section-${column.id}`;

  const addCard = () => {
    onToggle(column.id, true);
    setComposing(true);
  };

  return (
    <section
      ref={setNodeRef}
      className={`list-section${isOver ? " is-over" : ""}${collapsed ? " is-collapsed" : ""}`}
      aria-label={column.name}
    >
      <header className="list-section-header">
        <button
          type="button"
          className="list-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => onToggle(column.id)}
        >
          <ChevronRight size={15} className="list-chevron" aria-hidden />
          <StatusIcon icon={columnIcon(column)} />
          <span className="list-section-name">{column.name || "Untitled"}</span>
          <span className="column-count">{visible.length}</span>
        </button>
        {!readOnly && (
          <button
            type="button"
            className="icon-btn list-section-add"
            aria-label={`Add card to ${column.name}`}
            title="Add card"
            onClick={addCard}
          >
            <Plus size={15} />
          </button>
        )}
      </header>

      {!collapsed && (
        <div id={bodyId}>
          <SortableContext items={visible} strategy={verticalListSortingStrategy}>
            <div className="list-rows">
              {visible.map((id) => (
                <SortableListRow key={id} card={cards[id]!} onOpen={onOpenCard} />
              ))}
            </div>
          </SortableContext>
          {readOnly ? (
            !visible.length && <p className="list-empty">No cards</p>
          ) : composing ? (
            <div className="list-composer">
              <Composer
                onAdd={(title) =>
                  dispatch({
                    type: "addCard",
                    columnId: column.id,
                    card: { id: newId(), title, description: "", priority: "none", size: "none", assignee: "" },
                  })
                }
                onClose={() => setComposing(false)}
              />
            </div>
          ) : (
            <button type="button" className="list-add-row" onClick={addCard}>
              <Plus size={14} />
              {visible.length ? "Add card" : "No cards yet — add one"}
            </button>
          )}
        </div>
      )}
    </section>
  );
});

function SortableListRow({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <ListRowContent
      card={card}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`list-row${isDragging ? " is-placeholder" : ""}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable card"
      aria-label={`#${card.number} ${card.title || "Untitled"}`}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(card.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    />
  );
}

type RowProps = React.HTMLAttributes<HTMLDivElement> & { card: Card; ref?: React.Ref<HTMLDivElement> };

/** One card as a row: number, priority, title, assignee, size, last updated. */
function ListRowContent({ card, ...props }: RowProps) {
  return (
    <div {...props}>
      <span className="list-number">#{card.number}</span>
      <span className="list-priority" title={`Priority: ${PRIORITY_LABEL[card.priority]}`}>
        <PriorityIcon priority={card.priority} />
      </span>
      <span className="list-title">
        <span className={`list-title-text${card.title ? "" : " is-empty"}`}>{card.title || "Untitled"}</span>
        {card.description && <AlignLeft size={13} className="list-has-desc" aria-label="Has description" />}
      </span>
      <span className="list-assignee">
        {card.assignee && (
          <>
            <span className="avatar" aria-hidden>
              {card.assignee[0]!.toUpperCase()}
            </span>
            <span className="list-assignee-name">{card.assignee}</span>
          </>
        )}
      </span>
      <span className="list-size">
        {card.size !== "none" && <span className="size-badge">{card.size.toUpperCase()}</span>}
      </span>
      <span className="list-updated" title={new Date(card.updatedAt).toLocaleString()}>
        {timeAgo(card.updatedAt)}
      </span>
    </div>
  );
}

/** Which sections are collapsed, remembered per project in this browser. */
function useCollapsedSections(projectId: string) {
  const key = `kanban.collapsed.${projectId}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback(
    (columnId: string, open?: boolean) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        const shouldOpen = open ?? next.has(columnId);
        if (shouldOpen) next.delete(columnId);
        else next.add(columnId);
        if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {}
        return next;
      });
    },
    [key],
  );
  return [collapsed, toggle] as const;
}
