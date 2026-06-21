import { ChartConfiguration, ChartOptions } from 'chart.js';
import { formatCurrency } from './format.utils';

export const CHART_COLORS = {
  primary: '#00d09c',
  primaryDark: '#00b88a',
  primaryLight: 'rgba(0, 208, 156, 0.12)',
  secondary: '#6366f1',
  secondaryLight: 'rgba(99, 102, 241, 0.12)',
  success: '#10b981',
  successSoft: 'rgba(16, 185, 129, 0.85)',
  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.85)',
  neutral: '#94a3b8',
  ink: '#0f172a',
  muted: '#64748b',
  grid: 'rgba(148, 163, 184, 0.2)',
  border: 'rgba(148, 163, 184, 0.35)',
  palette: [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b',
  ],
};

const FONT = { family: 'Inter, system-ui, -apple-system, sans-serif' };

export function isMobileChart(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export function abbreviateLabel(label: string, max = 12): string {
  if (label.length <= max) return label;
  return label.slice(0, max - 1) + '…';
}

export function pnlColor(value: number, alpha = 0.88): string {
  return value >= 0
    ? `rgba(16, 185, 129, ${alpha})`
    : `rgba(239, 68, 68, ${alpha})`;
}

function currencyTooltipLabel(label: string, value: number): string {
  return `${label}: ${formatCurrency(value)}`;
}

function percentTooltipLabel(label: string, value: number): string {
  return `${label}: ${value.toFixed(1)}%`;
}

function baseLayout(): ChartOptions['layout'] {
  return { padding: { top: 4, right: 8, bottom: 0, left: 4 } };
}

function baseTooltip() {
  return {
    backgroundColor: CHART_COLORS.ink,
    titleColor: '#f8fafc',
    bodyColor: '#e2e8f0',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    titleFont: { ...FONT, size: 12, weight: 'bold' as const },
    bodyFont: { ...FONT, size: 12 },
    padding: 12,
    cornerRadius: 10,
    displayColors: true,
    boxWidth: 8,
    boxHeight: 8,
    boxPadding: 6,
  };
}

export function baseLegendPublic(show: boolean): ChartOptions['plugins'] {
  return baseLegend(show);
}

function baseLegend(show: boolean): ChartOptions['plugins'] {
  const mobile = isMobileChart();
  return {
    legend: {
      display: show,
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        boxWidth: mobile ? 8 : 10,
        boxHeight: mobile ? 8 : 10,
        padding: mobile ? 8 : 14,
        font: { ...FONT, size: mobile ? 10 : 11 },
        color: CHART_COLORS.muted,
        usePointStyle: true,
        pointStyle: 'circle' as const,
      },
    },
  };
}

function baseScales(options?: { currency?: boolean; percent?: boolean; horizontal?: boolean }): ChartOptions['scales'] {
  const mobile = isMobileChart();
  const currency = options?.currency !== false;
  const percent = options?.percent ?? false;
  const horizontal = options?.horizontal ?? false;

  const valueTicks = {
    font: { ...FONT, size: mobile ? 9 : 11 },
    color: CHART_COLORS.muted,
    padding: 6,
    maxTicksLimit: mobile ? 4 : 6,
    callback: (v: string | number) =>
      percent ? `${Number(v)}%` : currency ? formatCurrency(Number(v)) : String(v),
  };

  const categoryTicks = {
    maxRotation: mobile ? 35 : 0,
    minRotation: 0,
    autoSkip: true,
    maxTicksLimit: mobile ? 5 : 14,
    font: { ...FONT, size: mobile ? 9 : 11 },
    color: CHART_COLORS.muted,
    padding: 4,
  };

  if (horizontal) {
    return {
      x: {
        grid: { color: CHART_COLORS.grid },
        border: { display: false },
        ticks: valueTicks,
        grace: '5%',
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: categoryTicks,
      },
    };
  }

  return {
    x: {
      grid: { display: false },
      border: { display: false },
      ticks: categoryTicks,
    },
    y: {
      grid: { color: CHART_COLORS.grid },
      border: { display: false },
      ticks: valueTicks,
      grace: '8%',
    },
  };
}

function baseAnimation(): ChartOptions['animation'] {
  return { duration: isMobileChart() ? 350 : 550, easing: 'easeOutQuart' };
}

const BAR_DATASET_DEFAULTS = {
  borderRadius: 6,
  borderSkipped: false,
  maxBarThickness: 52,
  barPercentage: 0.72,
  categoryPercentage: 0.82,
};

export function barChartOptions(title: string, horizontal = false): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: baseAnimation(),
    layout: baseLayout(),
    plugins: {
      ...baseLegend(false),
      title: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => currencyTooltipLabel(
            ctx.dataset.label ?? '',
            Number(horizontal ? ctx.parsed.x : ctx.parsed.y)
          ),
        },
      },
    },
    scales: baseScales({ horizontal }),
  };
}

export function sparklineChartOptions(): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4, right: 6, bottom: 4, left: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          title: (items) => items[0]?.label ?? '',
          label: (ctx) => currencyTooltipLabel(ctx.dataset.label ?? '', Number(ctx.parsed.y)),
        },
      },
    },
    scales: {
      x: { display: false },
      y: { display: false },
    },
    elements: {
      point: { radius: 0, hoverRadius: 4, hitRadius: 16 },
      line: { tension: 0.4, borderWidth: 2 },
    },
  };
}

export function inlineBarChartOptions(): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250, easing: 'easeOutQuart' },
    layout: { padding: { top: 0, right: 2, bottom: 0, left: 0 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => currencyTooltipLabel(ctx.dataset.label ?? '', Number(ctx.parsed.y)),
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          font: { size: 9 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 5,
          color: CHART_COLORS.muted,
          padding: 0,
        },
      },
      y: {
        display: false,
        grid: { display: false },
        border: { display: false },
      },
    },
  };
}

export function groupedBarChartOptions(title: string): ChartOptions {
  return {
    ...barChartOptions(title),
    plugins: {
      ...barChartOptions(title).plugins,
      ...baseLegend(true),
    },
  };
}

export function scatterChartOptions(xLabel: string, yLabel: string, xCurrency = false, yCurrency = false, yPercent = false): ChartOptions {
  const mobile = isMobileChart();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: baseAnimation(),
    layout: baseLayout(),
    plugins: {
      ...baseLegend(false),
      title: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => {
            const x = Number((ctx.raw as { x: number; y: number }).x);
            const y = Number((ctx.raw as { x: number; y: number }).y);
            const xStr = xCurrency ? formatCurrency(x) : String(x);
            const yStr = yCurrency ? formatCurrency(y) : yPercent ? `${y.toFixed(1)}%` : String(y);
            return `${xLabel}: ${xStr}  ·  ${yLabel}: ${yStr}`;
          },
          title: (items) => (items[0]?.dataset?.label ?? ''),
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_COLORS.grid },
        border: { display: false },
        title: {
          display: !mobile,
          text: xLabel,
          font: { ...FONT, size: 11 },
          color: CHART_COLORS.muted,
          padding: { top: 4 },
        },
        ticks: {
          font: { ...FONT, size: mobile ? 9 : 11 },
          color: CHART_COLORS.muted,
          maxTicksLimit: mobile ? 5 : 8,
          callback: (v) => xCurrency ? formatCurrency(Number(v)) : String(v),
        },
      },
      y: {
        grid: { color: CHART_COLORS.grid },
        border: { display: false },
        title: {
          display: !mobile,
          text: yLabel,
          font: { ...FONT, size: 11 },
          color: CHART_COLORS.muted,
          padding: { bottom: 4 },
        },
        ticks: {
          font: { ...FONT, size: mobile ? 9 : 11 },
          color: CHART_COLORS.muted,
          maxTicksLimit: 5,
          callback: (v) => yCurrency ? formatCurrency(Number(v)) : yPercent ? `${Number(v)}%` : String(v),
        },
        grace: '10%',
      },
    },
    elements: {
      point: { radius: mobile ? 4 : 5, hoverRadius: 7, hitRadius: 10 },
    },
  };
}

export function comboChartOptions(title: string): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: baseAnimation(),
    layout: baseLayout(),
    plugins: {
      ...baseLegend(true),
      title: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => currencyTooltipLabel(ctx.dataset.label ?? '', Number(ctx.parsed.y)),
        },
      },
    },
    scales: baseScales(),
  };
}

export function lineChartOptions(title: string, percent = false): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: baseAnimation(),
    layout: baseLayout(),
    plugins: {
      ...baseLegend(false),
      title: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => percent
            ? percentTooltipLabel(ctx.dataset.label ?? '', Number(ctx.parsed.y))
            : currencyTooltipLabel(ctx.dataset.label ?? '', Number(ctx.parsed.y)),
        },
      },
    },
    scales: baseScales({ percent }),
    elements: {
      point: { radius: isMobileChart() ? 2 : 3, hoverRadius: 5, hitRadius: 12 },
      line: { tension: 0.35, borderWidth: 2.5 },
    },
  };
}

export function countBarChartOptions(title: string): ChartOptions {
  return {
    ...barChartOptions(title),
    plugins: {
      ...barChartOptions(title).plugins,
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} trades`,
        },
      },
    },
    scales: baseScales({ currency: false }),
  };
}

export function doughnutChartOptions(title: string): ChartOptions<'doughnut'> {
  const mobile = isMobileChart();
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    animation: { duration: mobile ? 350 : 550, easing: 'easeOutQuart' },
    layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
    plugins: {
      ...baseLegend(true),
      title: { display: false },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => {
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
            const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
            return `${ctx.label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
          },
        },
      },
    },
  };
}

export function pieChartOptions(title: string): ChartOptions<'pie'> {
  const mobile = isMobileChart();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: mobile ? 350 : 550, easing: 'easeOutQuart' },
    layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
    plugins: {
      title: { display: false },
      legend: {
        display: true,
        position: mobile ? 'bottom' : 'right',
        align: 'center',
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          padding: mobile ? 10 : 14,
          font: { ...FONT, size: mobile ? 10 : 11 },
          color: CHART_COLORS.muted,
          usePointStyle: true,
        },
      },
      tooltip: {
        ...baseTooltip(),
        callbacks: {
          label: (ctx) => {
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
            const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
            return `${ctx.label}: ${formatCurrency(Number(ctx.parsed))} (${pct}%)`;
          },
        },
      },
    },
  };
}

export function withDecimation(config: ChartConfiguration): ChartConfiguration {
  if (config.type !== 'line' && config.type !== 'bar') {
    return config;
  }
  return {
    ...config,
    data: config.data
      ? {
          ...config.data,
          datasets: config.data.datasets?.map((ds) => ({ ...ds })),
        }
      : config.data,
    options: {
      ...config.options,
      plugins: {
        ...config.options?.plugins,
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: 60,
        },
      },
    },
  };
}

export function buildPnLBarDataset(label: string, values: number[]) {
  return {
    label,
    data: values,
    backgroundColor: values.map((v) => pnlColor(v)),
    hoverBackgroundColor: values.map((v) => pnlColor(v, 1)),
    ...BAR_DATASET_DEFAULTS,
  };
}

export function buildLineDataset(
  label: string,
  values: number[],
  color: string,
  fillColor?: string
) {
  return {
    label,
    data: values,
    borderColor: color,
    backgroundColor: fillColor ?? 'transparent',
    fill: !!fillColor,
    tension: 0.35,
    borderWidth: 2.5,
    pointBackgroundColor: '#fff',
    pointBorderColor: color,
    pointBorderWidth: 2,
    pointRadius: isMobileChart() ? 2 : 3,
    pointHoverRadius: 5,
  };
}
