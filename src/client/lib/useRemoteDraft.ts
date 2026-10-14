import { useEffect, useRef, useState } from "react";

/**
 * A text field that edits a shared value: keeps a local draft while focused,
 * commits after a short pause or on blur, and follows remote changes otherwise.
 */
export function useRemoteDraft<E extends HTMLInputElement | HTMLTextAreaElement = HTMLTextAreaElement>(
  remote: string,
  commit: (value: string) => void,
) {
  const [draft, setDraft] = useState(remote);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ draft, remote, commit });
  latest.current = { draft, remote, commit };

  useEffect(() => {
    if (!focused.current) setDraft(remote);
  }, [remote]);

  const flush = () => {
    clearTimeout(timer.current);
    const { draft, remote, commit } = latest.current;
    if (draft !== remote) commit(draft);
  };

  // Save anything outstanding on unmount (e.g. closing a dialog mid-edit).
  useEffect(() => flush, []);

  return {
    value: draft,
    onChange: (e: React.ChangeEvent<E>) => {
      setDraft(e.target.value);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      flush();
    },
  };
}
