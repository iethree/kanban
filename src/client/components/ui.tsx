import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { Priority } from "../../shared/types";
import { useTheme, type ThemePref } from "../lib/theme";

// -- Menu -------------------------------------------------------------------

const MenuContext = createContext<() => void>(() => {});

export function Menu({
  label,
  trigger,
  children,
  align = "end",
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
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
        className="icon-btn"
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
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const close = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? " danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {icon}
      <span>{children}</span>
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
