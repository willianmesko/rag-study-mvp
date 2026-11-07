import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let observed = "";
let revision = 0;

export function browserLocation(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;
}
export function navigationRevision(): number { return revision; }
function changed() {
  const next = browserLocation();
  if (next === observed) return;
  observed = next;
  revision++;
  for (const listener of listeners) listener();
}
export function subscribeBrowserLocation(listener: () => void): () => void {
  if (listeners.size === 0) {
    observed = browserLocation();
    window.addEventListener("popstate", changed);
  }
  const subscription = () => listener();
  listeners.add(subscription);
  return () => {
    if (!listeners.delete(subscription)) return;
    if (listeners.size === 0) window.removeEventListener("popstate", changed);
  };
}
const serverLocation = () => "/";
export function useBrowserLocation() {
  return useSyncExternalStore(subscribeBrowserLocation, browserLocation, serverLocation);
}
