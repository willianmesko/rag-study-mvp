import { createServer } from "node:http";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export const eventLoopResolutionMs = 20;
const milliseconds = (value) => Number.isFinite(value) && value >= 0 ? Math.round(value / 1000) / 1000 : null;
export function nativeDelaySnapshot(histogram, utilization) {
  const samples = Number.isSafeInteger(histogram.count) && histogram.count >= 0 ? histogram.count : null;
  const measured = samples !== null && samples > 0;
  return { samples, delayMs: {
    min: measured ? milliseconds(histogram.min) : null,
    p50: measured ? milliseconds(histogram.percentile(50)) : null,
    p95: measured ? milliseconds(histogram.percentile(95)) : null,
    p99: measured ? milliseconds(histogram.percentile(99)) : null,
    max: measured ? milliseconds(histogram.max) : null,
    mean: measured ? milliseconds(histogram.mean) : null,
    stddev: measured ? milliseconds(histogram.stddev) : null,
  }, utilization: Number.isFinite(utilization) && utilization >= 0 && utilization <= 1 ? utilization : null };
}

// Lab-only preload: no environment/file/application reads and no request data in receipts.
export function createEventLoopProbe() {
  const histogram = monitorEventLoopDelay({ resolution: eventLoopResolutionMs });
  histogram.enable();
  let baseline = performance.eventLoopUtilization();
  const server = createServer({ maxHeaderSize: 4096, requestTimeout: 1000, headersTimeout: 1000 }, (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(value));
    };
    if (request.method === "POST" && request.url === "/reset") {
      histogram.reset(); baseline = performance.eventLoopUtilization(); return send(200, { reset: true });
    }
    if (request.method === "GET" && request.url === "/metrics")
      return send(200, nativeDelaySnapshot(histogram, performance.eventLoopUtilization(baseline).utilization));
    send(404, { error: "not_found" });
  });
  server.on("close", () => histogram.disable());
  return server;
}
