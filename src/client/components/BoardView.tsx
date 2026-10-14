import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { LIMITS, type Doc, type Op } from "../../shared/types";
import { newId } from "../../shared/validate";
import { CardOverlay } from "./Card";
import { BoardColumn } from "./Column";

type Items = Record<string, string[]>;

export function BoardView({ doc, dispatch, onOpenCard }: { doc: Doc; dispatch: (op: Op) => void; onOpenCard: (id: string) => void }) {
  // While dragging we work on a local copy of the column → card lists so the
  // card can hop between columns freely; the move is only sent on drop.
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastOverId = useRef<UniqueIdentifier | null>(null);
  const recentlyMoved = useRef(false);

  const docItems = useMemo(() => Object.fromEntries(doc.columns.map((c) => [c.id, c.cardIds])), [doc.columns]);
  const items = dragItems ?? docItems;

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMoved.current = false;
    });
  }, [dragItems]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );

  const findColumn = (id: UniqueIdentifier, from: Items = items) => {
    const key = String(id);
    if (key in from) return key;
    return Object.keys(from).find((col) => from[col]!.includes(key));
  };

  // Based on dnd-kit's multiple-containers example: prefer the column under the
  // pointer, then the closest card inside it. Avoids flicker at column edges.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(hits, "id");

      if (overId != null) {
        const columnCards = items[String(overId)];
        if (columnCards && columnCards.length > 0) {
          overId =
            closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) => columnCards.includes(String(c.id))),
            })[0]?.id ?? overId;
        }
        lastOverId.current = overId;
        return [{ id: overId }];
      }
      if (recentlyMoved.current && activeId) lastOverId.current = activeId;
      return lastOverId.current ? [{ id: lastOverId.current }] : [];
    },
    [items, activeId],
  );

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragItems(docItems);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return;
    const from = findColumn(active.id, dragItems);
    const to = findColumn(over.id, dragItems);
    if (!from || !to || from === to) return;

    setDragItems((prev) => {
      if (!prev) return prev;
      const toItems = prev[to]!;
      const activeKey = String(active.id);
      let index = toItems.length;
      if (!(String(over.id) in prev)) {
        const overIndex = toItems.indexOf(String(over.id));
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      recentlyMoved.current = true;
      return {
        ...prev,
        [from]: prev[from]!.filter((id) => id !== activeKey),
        [to]: [...toItems.slice(0, index), activeKey, ...toItems.slice(index)],
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const finalItems = dragItems;
    setDragItems(null);
    setActiveId(null);
    if (!over || !finalItems) return;

    const columnId = findColumn(id, finalItems);
    if (!columnId) return;
    let list = finalItems[columnId]!;
    if (findColumn(over.id, finalItems) === columnId) {
      const oldIndex = list.indexOf(id);
      const newIndex = String(over.id) === columnId ? list.length - 1 : list.indexOf(String(over.id));
      if (newIndex >= 0 && oldIndex !== newIndex) list = arrayMove(list, oldIndex, newIndex);
    }
    const index = list.indexOf(id);
    const originalColumn = doc.columns.find((c) => c.cardIds.includes(id));
    if (originalColumn?.id === columnId && originalColumn.cardIds.indexOf(id) === index) return;
    dispatch({ type: "moveCard", id, columnId, index });
  };

  const activeCard = activeId ? doc.cards[activeId] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragItems(null);
        setActiveId(null);
      }}
    >
      <div className="board">
        {doc.columns.map((column, i) => (
          <BoardColumn
            key={column.id}
            column={column}
            cardIds={items[column.id] ?? column.cardIds}
            cards={doc.cards}
            index={i}
            columnCount={doc.columns.length}
            dispatch={dispatch}
            onOpenCard={onOpenCard}
          />
        ))}
        <AddColumn
          disabled={doc.columns.length >= LIMITS.columns}
          onAdd={(name) => dispatch({ type: "addColumn", id: newId(), name })}
        />
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }}>
        {activeCard ? <CardOverlay card={activeCard} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function AddColumn({ onAdd, disabled }: { onAdd: (name: string) => void; disabled: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  if (value === null) {
    return (
      <button type="button" className="add-column" onClick={() => setValue("")} disabled={disabled}>
        <Plus size={15} />
        Add column
      </button>
    );
  }
  const submit = () => {
    if (value.trim()) onAdd(value.trim());
    setValue(null);
  };
  return (
    <div className="add-column is-editing">
      <input
        autoFocus
        value={value}
        maxLength={LIMITS.name}
        placeholder="Column name"
        aria-label="New column name"
        onChange={(e) => setValue(e.target.value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setValue(null);
        }}
      />
    </div>
  );
}
export function BoardSkeleton({ still = false }: { still?: boolean }) {
  return (
    <div className={`board skeleton${still ? " still" : ""}`} aria-hidden>
      {[3, 2, 1].map((n, i) => (
        <div key={i} className="column">
          <div className="skeleton-line" style={{ width: 90 }} />
          {Array.from({ length: n }, (_, j) => (
            <div key={j} className="skeleton-card" />
          ))}
        </div>
      ))}
    </div>
  );
}
