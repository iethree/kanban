import { useEffect, useState } from "react";

export function navigate(to: string, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function usePathname() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onChange = () => setPath(location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return path;
}

/** Reads and writes a single query-string param without adding history entries. */
export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState(() => new URLSearchParams(location.search).get(name));
  useEffect(() => {
    const onChange = () => setValue(new URLSearchParams(location.search).get(name));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, [name]);
  const update = (next: string | null) => {
    const url = new URL(location.href);
    if (next === null) url.searchParams.delete(name);
    else url.searchParams.set(name, next);
    history.replaceState(null, "", url);
    setValue(next);
  };
  return [value, update];
}
