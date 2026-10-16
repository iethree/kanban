import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
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
  type DndContextProps,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Doc, Op } from "../../shared/types";

type Items = Record<string, string[]>;

/**
 * Drag-and-drop for cards across status containers, shared by the board and
 * list views. Each column is a droppable container (keyed by column id) and
 * each card is a sortable item (keyed by card id).
 *
 * While dragging we work on a local copy of the column → card lists so a card
 * can hop between containers freely; the move is only sent on drop.
 */
export function useCardDnd(doc: Doc, dispatch: (op: Op) => void) {
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

  const findContainer = (id: UniqueIdentifier, from: Items = items) => {
    const key = String(id);
    if (key in from) return key;
    return Object.keys(from).find((col) => from[col]!.includes(key));
  };

  // Based on dnd-kit's multiple-containers example: prefer the container under
  // the pointer, then the closest card inside it. Avoids flicker at edges.
  // Containers whose cards aren't rendered (e.g. a collapsed list section)
  // have no card droppables, so the container itself is the target.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args);
      const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
      let overId = getFirstCollision(hits, "id");

      if (overId != null) {
        const containerCards = items[String(overId)];
        if (containerCards && containerCards.length > 0) {
          overId =
            closestCenter({
              ...args,
              droppableContainers: args.droppableContainers.filter((c) => containerCards.includes(String(c.id))),
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
    const from = findContainer(active.id, dragItems);
    const to = findContainer(over.id, dragItems);
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

    const columnId = findContainer(id, finalItems);
    if (!columnId) return;
    let list = finalItems[columnId]!;
    if (findContainer(over.id, finalItems) === columnId) {
      const oldIndex = list.indexOf(id);
      const newIndex = String(over.id) === columnId ? list.length - 1 : list.indexOf(String(over.id));
      if (newIndex >= 0 && oldIndex !== newIndex) list = arrayMove(list, oldIndex, newIndex);
    }
    const index = list.indexOf(id);
    const originalColumn = doc.columns.find((c) => c.cardIds.includes(id));
    if (originalColumn?.id === columnId && originalColumn.cardIds.indexOf(id) === index) return;
    dispatch({ type: "moveCard", id, columnId, index });
  };

  const contextProps: DndContextProps = {
    sensors,
    collisionDetection,
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel: () => {
      setDragItems(null);
      setActiveId(null);
    },
  };

  return { items, activeCard: activeId ? doc.cards[activeId] : undefined, contextProps };
}

export const DROP_ANIMATION = { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" };
