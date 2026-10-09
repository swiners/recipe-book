import { useCallback, useEffect, useState } from "react";
import {
  clampServings, MAX_PLAN, parsePlan, parseTicked, PLAN_KEY, TICKED_KEY,
} from "./plan.ts";
import type { PlanEntry } from "./plan.ts";

/* localStorage can throw (private browsing, storage disabled, quota). The plan is a
   convenience, so a failed write must not break the app: it just does not persist. */
const read = (key: string): string | null => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value); } catch { /* not persisted; still works this session */ }
};

export function usePlan() {
  const [plan, setPlan] = useState<PlanEntry[]>(() => parsePlan(read(PLAN_KEY)));
  const [ticked, setTicked] = useState<string[]>(() => parseTicked(read(TICKED_KEY)));

  // A second tab changing the plan should show up here. `storage` only fires in the
  // OTHER tabs, so this never loops with our own writes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PLAN_KEY) setPlan(parsePlan(e.newValue));
      if (e.key === TICKED_KEY) setTicked(parseTicked(e.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commitPlan = useCallback((next: PlanEntry[]) => {
    setPlan(next);
    write(PLAN_KEY, JSON.stringify(next));
  }, []);

  const commitTicked = useCallback((next: string[]) => {
    setTicked(next);
    write(TICKED_KEY, JSON.stringify(next));
  }, []);

  const has = (id: string) => plan.some((p) => p.id === id);

  const toggle = (id: string, servings: number | null) => {
    if (has(id)) commitPlan(plan.filter((p) => p.id !== id));
    else if (plan.length < MAX_PLAN) commitPlan([...plan, { id, servings }]);
  };

  const setServings = (id: string, n: number) =>
    commitPlan(plan.map((p) => (p.id === id ? { ...p, servings: clampServings(n) } : p)));

  const remove = (id: string) => commitPlan(plan.filter((p) => p.id !== id));

  const toggleTicked = (key: string) =>
    commitTicked(ticked.includes(key) ? ticked.filter((k) => k !== key) : [...ticked, key]);

  const clearTicked = () => commitTicked([]);
  const clearAll = () => { commitPlan([]); commitTicked([]); };

  return { plan, has, toggle, setServings, remove, ticked: new Set(ticked), toggleTicked, clearTicked, clearAll };
}
