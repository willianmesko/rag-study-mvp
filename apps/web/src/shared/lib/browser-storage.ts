export function readBrowserValue(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

export function writeBrowserValue(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
}
