"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { csvAmount, formatDuration, toCsv, type CsvCell } from "@/lib/reports";
import { currencyFractionDigits, formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

export type ColumnKind = "text" | "number" | "money" | "duration" | "percent";

export type Column = {
  key: string;
  label: string;
  kind?: ColumnKind;
};

export type ChartSpec = {
  type: "bar" | "line";
  /** The column along the bottom. */
  x: string;
  series: { key: string; label: string }[];
  /** Lay bars sideways (long labels such as product names). */
  horizontal?: boolean;
};

const COLOURS = ["var(--chart-4)", "var(--chart-2)", "var(--chart-1)"];

type Row = Record<string, string | number | null>;

/**
 * A report chart with a table view and a CSV download of the same rows.
 * Numbers arrive ready-made from the database; this only draws them.
 */
export function ChartCard({
  title,
  description,
  rows,
  columns,
  chart,
  currency,
  fileName,
  initialView = "chart",
  className,
}: {
  title: string;
  description?: string;
  rows: Row[];
  columns: Column[];
  chart?: ChartSpec;
  /** Null when amounts mix currencies (shown as plain numbers). */
  currency: string | null;
  fileName: string;
  initialView?: "chart" | "table";
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">(
    chart ? initialView : "table",
  );
  const format = (value: string | number | null, kind: ColumnKind = "text") => {
    if (value === null || value === undefined) return "–";
    if (kind === "money" && typeof value === "number")
      return currency ? formatAmount(value, currency) : csvAmount(value);
    if (kind === "duration" && typeof value === "number")
      return formatDuration(value);
    if (kind === "percent" && typeof value === "number") return `${value}%`;
    if (kind === "number" && typeof value === "number")
      return value.toLocaleString("en-GB");
    return String(value);
  };

  function download() {
    const digits = currency ? currencyFractionDigits(currency) : 2;
    const csv = toCsv([
      columns.map((c) => c.label),
      ...rows.map((row) =>
        columns.map((c): CsvCell => {
          const value = row[c.key];
          if (c.kind === "money" && typeof value === "number")
            return csvAmount(value, digits);
          return value;
        }),
      ),
    ]);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const kindOf = (key: string) => columns.find((c) => c.key === key)?.kind;
  const moneyAxis = chart?.series.some((s) => kindOf(s.key) === "money");
  const tick = (value: number) =>
    moneyAxis
      ? currency
        ? formatAmount(Math.round(value), currency).replace(/\.00$/, "")
        : csvAmount(Math.round(value))
      : String(value);

  return (
    <section
      className={cn("flex flex-col gap-3 rounded-xl border p-4", className)}
      aria-label={title}
      data-testid="chart-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {chart ? (
            <div
              role="radiogroup"
              aria-label={`${title} view`}
              className="flex rounded-lg border p-0.5"
            >
              {(["chart", "table"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "min-h-10 rounded-md px-3 text-sm font-medium capitalize",
                    view === v ? "bg-foreground text-background" : "",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={download}
            disabled={rows.length === 0}
            aria-label={`Download ${title} as CSV`}
          >
            CSV
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">
          Nothing in these dates.
        </p>
      ) : view === "chart" && chart ? (
        <div
          className={cn(
            "w-full",
            chart.horizontal
              ? rows.length > 10
                ? "h-[28rem]"
                : "h-80"
              : "h-72",
          )}
        >
          <ResponsiveContainer width="100%" height="100%">
            {chart.type === "line" ? (
              <LineChart data={rows} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={chart.x} tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={tick}
                  tick={{ fontSize: 12 }}
                  width={72}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const s = chart.series.find((x) => x.label === name);
                    return format(
                      Math.round(Number(value)),
                      s ? kindOf(s.key) : "number",
                    );
                  }}
                />
                {chart.series.length > 1 ? <Legend /> : null}
                {chart.series.map((s, i) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={COLOURS[i % COLOURS.length]}
                    strokeWidth={2}
                    dot={rows.length <= 31}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart
                data={rows}
                layout={chart.horizontal ? "vertical" : "horizontal"}
                margin={{ left: 8, right: 16, top: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={!!chart.horizontal}
                  horizontal={!chart.horizontal}
                />
                {chart.horizontal ? (
                  <>
                    <XAxis
                      type="number"
                      tickFormatter={tick}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey={chart.x}
                      width={140}
                      tick={{ fontSize: 12 }}
                      interval={0}
                    />
                  </>
                ) : (
                  <>
                    <XAxis dataKey={chart.x} tick={{ fontSize: 12 }} />
                    <YAxis
                      tickFormatter={tick}
                      tick={{ fontSize: 12 }}
                      width={72}
                    />
                  </>
                )}
                <Tooltip
                  formatter={(value, name) => {
                    const s = chart.series.find((x) => x.label === name);
                    return format(
                      Math.round(Number(value)),
                      s ? kindOf(s.key) : "number",
                    );
                  }}
                />
                {chart.series.length > 1 ? <Legend /> : null}
                {chart.series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    fill={COLOURS[i % COLOURS.length]}
                    radius={3}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className={c.kind && c.kind !== "text" ? "text-right" : ""}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={
                        c.kind && c.kind !== "text"
                          ? "text-right tabular-nums"
                          : ""
                      }
                    >
                      {format(row[c.key], c.kind)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
