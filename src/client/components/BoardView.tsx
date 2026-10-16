import { useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { LIMITS, type Doc, type Op } from "../../shared/types";
import { newId } from "../../shared/validate";
import { DROP_ANIMATION, useCardDnd } from "../lib/useCardDnd";
import { CardOverlay } from "./Card";
import { BoardColumn } from "./Column";

export function BoardView({ doc, dispatch, onOpenCard }: { doc: Doc; dispatch: (op: Op) => void; onOpenCard: (id: string) => void }) {
  const { items, activeCard, contextProps } = useCardDnd(doc, dispatch);

  return (
    <DndContext {...contextProps}>
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
      <DragOverlay dropAnimation={DROP_ANIMATION}>{activeCard ? <CardOverlay card={activeCard} /> : null}</DragOverlay>
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
