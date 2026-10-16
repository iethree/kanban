import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlignLeft } from "lucide-react";
import type { Card } from "../../shared/types";
import { PRIORITY_LABEL, PriorityIcon } from "./ui";

export const CardBody = memo(function CardBody({ card }: { card: Card }) {
  return (
    <>
      <div className={`card-title${card.title ? "" : " is-empty"}`}>{card.title || "Untitled"}</div>
      <div className="card-meta">
        <span className="card-number">#{card.number}</span>
        {card.priority !== "none" && (
          <span
            className={`card-priority priority-${card.priority}`}
            title={`Priority: ${PRIORITY_LABEL[card.priority]}`}
          >
            <PriorityIcon priority={card.priority} />
            {PRIORITY_LABEL[card.priority]}
          </span>
        )}
        {card.description && (
          <span className="card-has-desc" title="Has description">
            <AlignLeft size={13} />
          </span>
        )}
        <span className="card-meta-end">
          {card.assignee && (
            <span className="card-assignee" title={`Claimed by ${card.assignee}`}>
              <span className="avatar" aria-hidden>
                {card.assignee[0]!.toUpperCase()}
              </span>
              <span className="card-assignee-name">{card.assignee}</span>
            </span>
          )}
          {card.size !== "none" && (
            <span className="size-badge" title={`Size: ${card.size.toUpperCase()}`}>
              {card.size.toUpperCase()}
            </span>
          )}
        </span>
      </div>
    </>
  );
});

export function SortableCard({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`card${isDragging ? " is-placeholder" : ""}`}
      {...attributes}
      {...listeners}
      aria-roledescription="Draggable card"
      aria-label={card.title || "Untitled card"}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(card.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    >
      <CardBody card={card} />
    </div>
  );
}

export function CardOverlay({ card }: { card: Card }) {
  return (
    <div className="card is-overlay">
      <CardBody card={card} />
    </div>
  );
}
