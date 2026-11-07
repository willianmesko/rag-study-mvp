import type { UsageResponse } from "@rag-study/contracts";
import { useLocale } from "../../../shared/i18n/locale";
import { dailySeries, formatUsageCost } from "../model/presentation";

export function UsageTrend({ data }: { data: UsageResponse }) {
  const { locale, t } = useLocale(),
    series = dailySeries(data),
    max = Math.max(...series.map((day) => day.cost), 0);
  const date = (day: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${day}T00:00:00Z`));
  return (
    <section
      aria-label={t("Daily recorded cost", "Custo diário registrado")}
      className="space-y-3"
    >
      <h3 className="text-sm font-semibold text-slate-100">
        {t("Daily recorded cost", "Custo diário registrado")}{" "}
        <span className="font-normal text-slate-400">· UTC</span>
      </h3>
      <figure>
        <div
          role="img"
          aria-label={t(
            "Daily cost trend in US dollars. Exact values are available in the daily breakdown below.",
            "Evolução diária de custo em dólares. Os valores exatos estão disponíveis no detalhamento diário abaixo.",
          )}
          className="flex h-24 items-end gap-px border-b border-slate-700"
        >
          {series.map((day) => (
            <div
              key={day.date}
              className="flex h-full min-w-0 flex-1 items-end"
              aria-hidden="true"
              title={`${date(day.date)}: ${formatUsageCost(day.cost, locale)}`}
            >
              <span
                className="w-full rounded-t bg-cyan-400/80"
                style={{
                  height: max > 0 ? `${(day.cost / max) * 100}%` : "0%",
                }}
              />
            </div>
          ))}
        </div>
        {series.length > 0 && (
          <figcaption className="mt-2 flex justify-between text-xs text-slate-400">
            <span>{date(series[0].date)}</span>
            <span>{date(series.at(-1)!.date)}</span>
          </figcaption>
        )}
      </figure>
      <details>
        <summary className="min-h-11 cursor-pointer rounded-md py-3 text-sm text-slate-300 hover:text-slate-100">
          {t("View daily amounts", "Ver valores por dia")}
        </summary>
        <div
          className="max-h-64 overflow-y-auto rounded-lg border border-slate-800"
          tabIndex={0}
          role="region"
          aria-label={t("Daily usage table", "Tabela de uso diário")}
        >
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              {t("Daily usage in UTC", "Uso diário em UTC")}
            </caption>
            <thead className="sticky top-0 bg-slate-950 text-slate-300">
              <tr>
                <th scope="col" className="p-3">
                  {t("Day", "Dia")}
                </th>
                <th scope="col" className="p-3">
                  {t("Operations", "Operações")}
                </th>
                <th scope="col" className="p-3 text-right">
                  {t("Recorded cost", "Custo registrado")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-slate-300">
              {[...series].reverse().map((day) => (
                <tr key={day.date}>
                  <th scope="row" className="p-3 font-normal">
                    <time dateTime={day.date}>{date(day.date)}</time>
                  </th>
                  <td className="p-3">{day.requests.toLocaleString(locale)}</td>
                  <td className="p-3 text-right font-mono">
                    {formatUsageCost(day.cost, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
