import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import type { ColumnIcon } from "../../shared/column-icons";
import type { Priority } from "../../shared/types";
import { useTheme, type ThemePref } from "../lib/theme";

// -- Menu -------------------------------------------------------------------

const MenuContext = createContext<() => void>(() => {});

export function Menu({
  label,
  trigger,
  children,
  align = "end",
  triggerClassName = "",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`icon-btn ${triggerClassName}`.trim()}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`menu-popover menu-${align}`} role="menu">
          <MenuContext.Provider value={() => setOpen(false)}>{children}</MenuContext.Provider>
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  disabled,
  checked,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Makes this one of a set of radio items; true marks the current choice. */
  checked?: boolean;
}) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={`menu-item${danger ? " danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      <span>{children}</span>
      {checked && <Check size={14} className="menu-check" aria-hidden />}
    </button>
  );
}

export const MenuSeparator = () => <div className="menu-sep" role="separator" />;

// -- Modal ------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  children,
  className = "",
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onPointerDown={(e) => {
        // Clicking the backdrop (the dialog element itself, outside the panel) closes it.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

// -- Text editing -----------------------------------------------------------

export function useAutosize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const resize = () => {
      const el = ref.current;
      if (!el) return false;
      el.style.height = "auto";
      // Zero means it isn't laid out yet (e.g. inside a dialog that's about to open).
      if (el.scrollHeight === 0) return false;
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
      return true;
    };
    if (resize()) return;
    const frame = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(frame);
  }, [ref, value]);
}

/** Text that turns into an input when clicked. Commits on blur or Enter. */
export function EditableText({
  value,
  onCommit,
  placeholder,
  multiline = false,
  className = "",
  maxLength,
  ariaLabel,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder: string;
  multiline?: boolean;
  className?: string;
  maxLength?: number;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutosize(textareaRef, draft ?? "");

  const commit = () => {
    if (draft === null) return;
    const next = multiline ? draft.trimEnd() : draft.trim();
    if (next !== value) onCommit(next);
    setDraft(null);
  };

  if (draft === null) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        className={`editable ${className}${value ? "" : " is-empty"}`}
        onClick={() => setDraft(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDraft(value);
          }
        }}
      >
        {value || placeholder}
      </div>
    );
  }

  const shared = {
    autoFocus: true,
    "aria-label": ariaLabel,
    className: `editable-input ${className}`,
    value: draft,
    placeholder,
    maxLength,
    onBlur: commit,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => e.currentTarget.select(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setDraft(null);
      } else if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
  };

  return multiline ? (
    <textarea ref={textareaRef} rows={1} {...shared} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input {...shared} onChange={(e) => setDraft(e.target.value)} />
  );
}

// -- Domain bits ------------------------------------------------------------

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function PriorityIcon({ priority }: { priority: Priority }) {
  const level = { none: 0, low: 1, medium: 2, high: 3 }[priority];
  return (
    <svg className={`priority-icon priority-${priority}`} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.5 + i * 4}
          y={9 - i * 3}
          width="3"
          height={4 + i * 3}
          rx="1"
          className={i < level ? "on" : "off"}
        />
      ))}
    </svg>
  );
}

/** Workflow status glyphs from escherize/lll, drawn on a 14px grid. */
export function StatusIcon({ icon, size = 14 }: { icon: ColumnIcon; size?: number }) {
  const ring = <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />;
  return (
    <svg className={`status-icon st-${icon}`} width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {icon === "backlog" && (
        <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 2.4" strokeLinecap="round" />
      )}
      {icon === "todo" && ring}
      {icon === "in-progress" && (
        <>
          {ring}
          <path d="M7 3.8 A3.2 3.2 0 0 1 10.2 7 L7 7 Z" fill="currentColor" />
        </>
      )}
      {icon === "in-review" && (
        <>
          {ring}
          <path d="M7 3.8 A3.2 3.2 0 1 1 3.8 7 L7 7 Z" fill="currentColor" />
        </>
      )}
      {icon === "done" && (
        <>
          <circle cx="7" cy="7" r="6.2" fill="currentColor" />
          <path d="M4.6 7.2 L6.3 8.9 L9.6 5.4" fill="none" className="st-cut" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {icon === "cancelled" && (
        <>
          <circle cx="7" cy="7" r="6.2" fill="currentColor" />
          <path d="M4.9 4.9 L9.1 9.1 M9.1 4.9 L4.9 9.1" className="st-cut" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const THEME_ORDER: ThemePref[] = ["system", "light", "dark"];

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!;
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next)}
      title={`Theme: ${theme} (switch to ${next})`}
      aria-label={`Theme: ${theme}. Switch to ${next}`}
    >
      <Icon size={16} />
    </button>
  );
}

export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden className="logo">
      <rect x="1" y="1" width="18" height="18" rx="5" className="logo-bg" />
      <rect x="5" y="5" width="2.6" height="10" rx="1.3" className="logo-fg" />
      <rect x="8.7" y="5" width="2.6" height="6.5" rx="1.3" className="logo-fg" />
      <rect x="12.4" y="5" width="2.6" height="8" rx="1.3" className="logo-fg" />
    </svg>
  );
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
