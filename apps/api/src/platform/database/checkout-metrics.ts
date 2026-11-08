import { metrics, type Histogram } from "@opentelemetry/api";

let duration: Histogram | undefined;

/** Guarded client acquisition only; never include query text, identity or errors. */
export function recordPostgresCheckout(outcome: "acquired" | "cancelled" | "failed", started: number): void {
  try {
    const seconds = (performance.now() - started) / 1000;
    if (!Number.isFinite(seconds) || seconds < 0) return;
    duration ??= metrics.getMeter("lumora.database", "1.0").createHistogram("lumora.database.checkout.duration", {
      unit: "s", description: "Guarded client checkout, including queue, connection and initialization; excludes SQL execution.",
    });
    duration.record(seconds, { outcome });
  } catch { /* Diagnostics cannot change checkout, cancellation or cleanup. */ }
}
