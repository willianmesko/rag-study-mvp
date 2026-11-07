import type { UsageResponse, UsageTotals } from "@rag-study/contracts";

export function recordedCost(
  value: Pick<UsageTotals, "effectiveCostUsd" | "estimatedCostUsd">,
) {
  return value.effectiveCostUsd ?? value.estimatedCostUsd;
}
export function estimatedRemainder(
  value: Pick<
    UsageTotals,
    | "effectiveCostUsd"
    | "estimatedCostUsd"
    | "observedCostUsd"
    | "estimatedOnlyCostUsd"
  >,
) {
  return (
    value.estimatedOnlyCostUsd ??
    Math.max(0, recordedCost(value) - value.observedCostUsd)
  );
}
export function formatUsageCost(value: number, locale: string) {
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
  return value > 0 && value < 0.000001
    ? `< ${format.format(0.000001)}`
    : format.format(value);
}
export function dailySeries(data: UsageResponse) {
  const indexed = new Map(data.summary.daily.map((day) => [day.date, day]));
  const first =
    data.summary.windowStart?.slice(0, 10) ?? data.summary.daily[0]?.date;
  const last =
    data.summary.windowEnd?.slice(0, 10) ?? data.summary.daily.at(-1)?.date;
  if (!first || !last) return [];
  const result: Array<{ date: string; cost: number; requests: number }> = [];
  const end = Date.parse(`${last}T00:00:00Z`);
  for (
    let day = Date.parse(`${first}T00:00:00Z`);
    day <= end && result.length <= 90;
    day += 86_400_000
  ) {
    const date = new Date(day).toISOString().slice(0, 10),
      value = indexed.get(date);
    result.push({
      date,
      cost: value ? recordedCost(value) : 0,
      requests: value?.requests ?? 0,
    });
  }
  return result;
}
