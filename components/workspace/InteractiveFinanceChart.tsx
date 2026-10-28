"use client";

import { useState } from "react";
import { formatBusinessDay, type DateFormat } from "@/lib/format";

export type FinanceChartPoint = {
  day: string;
  salesUgx: number;
  expensesUgx: number;
  netUgx: number;
  previousSalesUgx: number;
};

function money(value: number, currency: string, scale: number, locale: string) {
  const digits = Math.round(Math.log10(scale));
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / scale);
}

export function InteractiveFinanceChart({
  points,
  currency,
  scale,
  locale,
  dateFormat,
  accountFiltered = false,
  complete = true,
  compact = false,
  showPrevious = true,
}: {
  points: FinanceChartPoint[];
  currency: string;
  scale: number;
  locale: string;
  dateFormat: DateFormat;
  accountFiltered?: boolean;
  complete?: boolean;
  compact?: boolean;
  showPrevious?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  if (!complete) return <div className="interactive-finance-chart">
    <p className="notice-banner notice-warning interactive-chart-warning" role="status">The matching records exceeded the safe summary limit. Chart values are withheld; choose a shorter date range to see complete results.</p>
    <div className="empty-state compact-empty"><strong>Complete chart unavailable for this range.</strong><span>No partial totals are shown.</span></div>
  </div>;
  if (!points.length || !points.some(point => point.salesUgx || point.expensesUgx || (showPrevious && point.previousSalesUgx))) {
    return <div className="empty-state compact-empty"><strong>No recorded activity in this period.</strong><span>Chart values come from saved workspace records.</span></div>;
  }

  const width = Math.max(900, points.length * 28);
  const height = compact ? 170 : 250;
  const left = 34;
  const right = width - 18;
  const top = 16;
  const bottom = height - 34;
  const plotHeight = bottom - top;
  const gap = (right - left) / points.length;
  const values = points.flatMap(point => showPrevious ? [point.salesUgx, point.expensesUgx, point.netUgx, point.previousSalesUgx] : [point.salesUgx, point.expensesUgx, point.netUgx]);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const xAt = (index: number) => left + gap * index + gap / 2;
  const yAt = (value: number) => bottom - (value - min) / (max - min) * plotHeight;
  const salesLine = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(point.previousSalesUgx)}`).join(" ");
  const expenseLine = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(point.expensesUgx)}`).join(" ");
  const netLine = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xAt(index)} ${yAt(point.netUgx)}`).join(" ");
  const selected = activeIndex === null ? null : points[activeIndex];
  const selectedX = activeIndex === null ? null : xAt(activeIndex);
  const date = (value: string) => formatBusinessDay(value, dateFormat);
  const percentChange = showPrevious && selected && selected.previousSalesUgx > 0 ? Math.round((selected.salesUgx - selected.previousSalesUgx) / selected.previousSalesUgx * 100) : null;
  const axisIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return <div className={`interactive-finance-chart${compact ? " is-compact" : ""}`}>
    {selected && <div className="interactive-chart-tooltip" role="status" aria-live="polite">
      <strong>{date(selected.day)}</strong>
      <span><i className="chart-mark chart-mark-sales" />Sales <b>{money(selected.salesUgx, currency, scale, locale)}</b></span>
      <span><i className="chart-mark chart-mark-expenses" />Expenses <b>{money(selected.expensesUgx, currency, scale, locale)}</b></span>
      <span><i className="chart-mark chart-mark-net" />Net <b>{money(selected.netUgx, currency, scale, locale)}</b></span>
      {showPrevious && <span><i className="chart-mark chart-mark-previous" />Previous period sales <b>{money(selected.previousSalesUgx, currency, scale, locale)}</b></span>}
      {percentChange !== null && <span className={`chart-tooltip-change${percentChange < 0 ? " is-negative" : ""}`}>{percentChange > 0 ? "+" : ""}{percentChange}% vs previous period</span>}
    </div>}
    <div className="interactive-chart-scroll" onPointerLeave={() => setActiveIndex(null)}>
      <svg className="interactive-chart-svg" style={{ width: `${width}px`, minWidth: `${width}px` }} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Sales and expenses by date${accountFiltered ? ", filtered by account" : ""}`}>
        {[0, 1, 2, 3].map(tick => {
          const y = top + plotHeight * tick / 3;
          const value = max - (max - min) * tick / 3;
          return <g key={tick}><line className="chart-grid-line" x1={left} x2={right} y1={y} y2={y} /><text className="chart-axis-label" x={left - 7} y={y + 3} textAnchor="end">{new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value / scale)}</text></g>;
        })}
        {activeIndex !== null && selectedX !== null && <rect className="chart-hover-band" x={selectedX - gap / 2} y={top} width={gap} height={bottom - top} />}
        {points.map((point, index) => {
          const barWidth = Math.max(3, Math.min(18, gap * 0.52));
          const baseline = yAt(0);
          const valueY = yAt(point.salesUgx);
          const barHeight = point.salesUgx > 0 ? Math.max(2, baseline - valueY) : 0;
          return <rect key={`bar-${point.day}`} className={`chart-sales-bar${activeIndex === index ? " is-active" : ""}`} x={xAt(index) - barWidth / 2} y={valueY} width={barWidth} height={barHeight} rx="3" />;
        })}
        <path className="chart-expenses-line" d={expenseLine} />
        <path className="chart-net-line" d={netLine} />
        {showPrevious && <path className="chart-previous-line" d={salesLine} />}
        {showPrevious && points.map((point, index) => <circle key={`previous-${point.day}`} className={`chart-previous-point${activeIndex === index ? " is-active" : ""}`} cx={xAt(index)} cy={yAt(point.previousSalesUgx)} r={activeIndex === index ? 4 : 2.5} />)}
        {points.map((point, index) => <rect key={`hit-${point.day}`} className="chart-hit-area" x={xAt(index) - gap / 2} y={top} width={gap} height={bottom - top} tabIndex={activeIndex === index || (activeIndex === null && index === 0) ? 0 : -1} role="button" aria-pressed={activeIndex === index} aria-label={`${date(point.day)}. Sales ${money(point.salesUgx, currency, scale, locale)}. Expenses ${money(point.expensesUgx, currency, scale, locale)}. Net ${money(point.netUgx, currency, scale, locale)}.${showPrevious ? ` Previous period sales ${money(point.previousSalesUgx, currency, scale, locale)}.` : ""}`} onPointerEnter={() => setActiveIndex(index)} onPointerLeave={event => { if (event.pointerType !== "touch") setActiveIndex(null); }} onFocus={() => setActiveIndex(index)} onBlur={() => setActiveIndex(null)} onClick={() => setActiveIndex(index)} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); const next = Math.max(0, Math.min(points.length - 1, index + (event.key === "ArrowRight" ? 1 : -1))); setActiveIndex(next); event.currentTarget.parentElement?.querySelector<SVGRectElement>(`[data-chart-index="${next}"]`)?.focus(); } if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActiveIndex(index); } if (event.key === "Escape") setActiveIndex(null); }} data-chart-index={index} />)}
        {axisIndices.map(index => <text key={`axis-${index}`} className="chart-axis-label chart-date-label" x={xAt(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}>{date(points[index]!.day)}</text>)}
      </svg>
    </div>
    <div className="interactive-chart-legend" aria-label="Chart legend"><span><i className="chart-mark chart-mark-sales" />Sales</span><span><i className="chart-mark chart-mark-expenses" />Expenses</span><span><i className="chart-mark chart-mark-net" />Net</span>{showPrevious && <span><i className="chart-mark chart-mark-previous" />Previous period sales</span>}</div>
  </div>;
}
