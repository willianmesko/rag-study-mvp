export type ClientSurface = "application" | "workspace" | "chat" | "onboarding" |
  "connections" | "guide" | "upload" | "consent";

export function reportRenderFailure(surface: ClientSurface) {
  // Never forward Error objects, component stacks, request bodies or credentials.
  console.error("Lumora client event", { code: "ui_render_failed", surface });
}
