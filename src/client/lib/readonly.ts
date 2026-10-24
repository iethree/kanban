import { createContext, useContext } from "react";

/** True when this browser may look at the project but not change it (no key, read-only public access). */
export const ReadOnlyContext = createContext(false);

export const useReadOnly = () => useContext(ReadOnlyContext);
