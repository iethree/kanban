import { memo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowLeft, ArrowRight, Ellipsis, Plus, Trash2 } from "lucide-react";
import { COLUMN_ICONS, COLUMN_ICON_LABEL, columnIcon } from "../../shared/column-icons";
import { LIMITS, type Card, type Column, type Op } from "../../shared/types";
import { newId } from "../../shared/validate";
import { SortableCard } from "./Card";
import { EditableText, Menu, MenuItem, MenuSeparator, StatusIcon, useAutosize } from "./ui";

interface Props {
  column: Column;
  cardIds: string[];
  cards: Record<string, Card>;
  index: number;
  columnCount: number;
  dispatch: (op: Op) => void;
  onOpenCard: (id: string) => void;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  cardIds,
  cards,
  index,
  columnCount,
  dispatch,
  onOpenCard,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [composing, setComposing] = useState(false);
  const visible = cardIds.filter((id) => cards[id]);

  return (
    <section ref={setNodeRef} className={`column${isOver ? " is-over" : ""}`} aria-label={column.name}>
      <header className="column-header">
        <ColumnIconMenu column={column} dispatch={dispatch} />
        <EditableText
          value={column.name}
          placeholder="Untitled"
          ariaLabel={`Rename column ${column.name}`}
          className="column-name"
          maxLength={LIMITS.name}
          onCommit={(name) => dispatch({ type: "renameColumn", id: column.id, name: name || column.name })}
        />
        <span className="column-count">{visible.length}</span>
        <div className="column-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={`Add card to ${column.name}`}
            title="Add card"
            onClick={() => setComposing(true)}
          >
            <Plus size={15} />
          </button>
          <Menu label="Column options" trigger={<Ellipsis size={15} />}>
            <MenuItem
              icon={<ArrowLeft size={14} />}
              disabled={index === 0}
              onSelect={() => dispatch({ type: "moveColumn", id: column.id, index: index - 1 })}
            >
              Move left
            </MenuItem>
            <MenuItem
              icon={<ArrowRight size={14} />}
              disabled={index === columnCount - 1}
              onSelect={() => dispatch({ type: "moveColumn", id: column.id, index: index + 1 })}
            >
              Move right
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              danger
              icon={<Trash2 size={14} />}
              onSelect={() => {
                const n = visible.length;
                if (n && !confirm(`Delete “${column.name}” and its ${n} card${n === 1 ? "" : "s"}? This can't be undone.`))
                  return;
                dispatch({ type: "deleteColumn", id: column.id });
              }}
            >
              Delete column
            </MenuItem>
          </Menu>
        </div>
      </header>

      <SortableContext items={visible} strategy={verticalListSortingStrategy}>
        <div className="column-cards">
          {visible.map((id) => (
            <SortableCard key={id} card={cards[id]!} onOpen={onOpenCard} />
          ))}
        </div>
      </SortableContext>

      {composing ? (
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
      ) : (
        <button type="button" className="add-card" onClick={() => setComposing(true)}>
          <Plus size={14} />
          Add card
        </button>
      )}
    </section>
  );
});

/** The column's status icon, which opens a picker; "Automatic" hands it back to the name rules and the model. */
export function ColumnIconMenu({ column, dispatch }: { column: Column; dispatch: (op: Op) => void }) {
  const current = columnIcon(column);
  const auto = !column.icon;
  return (
    <Menu
      label={`Icon for ${column.name || "column"}: ${COLUMN_ICON_LABEL[current]}${auto ? " (automatic)" : ""}`}
      trigger={<StatusIcon icon={current} />}
      align="start"
      triggerClassName="column-icon-btn"
    >
      <MenuItem checked={auto} icon={<StatusIcon icon={columnIcon({ ...column, icon: undefined })} />} onSelect={() => dispatch({ type: "setColumnIcon", id: column.id, icon: null })}>
        Automatic
      </MenuItem>
      <MenuSeparator />
      {COLUMN_ICONS.map((icon) => (
        <MenuItem
          key={icon}
          checked={!auto && column.icon === icon}
          icon={<StatusIcon icon={icon} />}
          onSelect={() => dispatch({ type: "setColumnIcon", id: column.id, icon })}
        >
          {COLUMN_ICON_LABEL[icon]}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function Composer({ onAdd, onClose }: { onAdd: (title: string) => void; onClose: () => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useAutosize(ref, value);

  const submit = () => {
    const title = value.trim();
    if (title) onAdd(title);
    setValue("");
    return !!title;
  };

  return (
    <div className="composer">
      <textarea
        ref={ref}
        autoFocus
        rows={1}
        value={value}
        maxLength={LIMITS.title}
        placeholder="Card title"
        aria-label="New card title"
        onChange={(e) => setValue(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            onClose();
          }
        }}
        onBlur={() => {
          if (cancelled.current) return;
          submit();
          onClose();
        }}
      />
      <div className="composer-hint">
        <kbd>Enter</kbd> to add · <kbd>Esc</kbd> to close
      </div>
    </div>
  );
}
