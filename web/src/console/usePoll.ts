import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api.ts";

/// Runs `fn` on mount, every `ms`, and on window focus. `refresh()` runs it at once.
export function usePoll<T>(fn: () => Promise<T>, ms: number): { data?: T; error?: ApiError; refresh(): void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const refresh = useCallback(() => {
    fnRef.current().then(
      (d) => (setData(d), setError(undefined)),
      (e) => setError(e instanceof ApiError ? e : new ApiError(0, String(e))),
    );
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, ms);
    addEventListener("focus", refresh);
    return () => (clearInterval(t), removeEventListener("focus", refresh));
  }, [refresh, ms]);
  return { data, error, refresh };
}
