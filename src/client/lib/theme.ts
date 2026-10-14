import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "kanban.theme";

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {}
  }, [theme]);
  return [theme, setTheme] as const;
}
