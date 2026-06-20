import { ChartConfiguration, ChartOptions } from 'chart.js';
import { formatCurrency } from './format.utils';

export const CHART_COLORS = {
  primary: '#00d09c',
  primaryLight: 'rgba(0, 208, 156, 0.15)',
  secondary: '#4e73df',
  success: '#00d09c',
  danger: '#dc3545',
  successAlpha: 'rgba(0, 208, 156, 0.75)',
  dangerAlpha: 'rgba(220, 53, 69, 0.75)',
  palette: [
    '#4e73df', '#00d09c', '#f6c23e', '#e74a3b', '#36b9cc',
    '#858796', '#5a5c69', '#1cc88a', '#fd7e14', '#6f42c1',
  ],
  grid: 'rgba(0, 0, 0, 0.06)',
  text: '#5a5c69',
};

export function isMobileChart(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

export function abbreviateLabel(label: string, max = 12): string {
  if (label.length <= max) return label;
  return label.slice(0, max - 1) + '…';
}

function basePlugins(title: string, legend = true): ChartOptions['plugins'] {
  const mobile = isMobileChart();
  return {
    title: {
      display: true,
      text: title,
      font: { size: mobile ? 13 : 15, weight: 'bold' },
      color: '#1a1d29',
      padding: { bottom: mobile ? 8 : 12 },
    },
    legend: {
      display: legend,
      position: mobile ? 'bottom' : 'top',
      labels: {
        boxWidth: 12,
        padding: mobile ? 10 : 16,
        font: { size: mobile ? 11 : 12 },
        color: CHART_COLORS.text,
      },
    },
    tooltip: {
      backgroundColor: '#1a1d29',
      titleFont: { size: 13 },
      bodyFont: { size: 12 },
      padding: 12,
      cornerRadius: 8,
      callbacks: {},
    },
  };
}

function baseScales(showX = true): ChartOptions['scales'] {
  const mobile = isMobileChart();
  return {
    x: {
      display: showX,
      grid: { display: false },
      ticks: {
        maxRotation: mobile ? 45 : 0,
        minRotation: mobile ? 45 : 0,
        autoSkip: true,
        maxTicksLimit: mobile ? 6 : 12,
        font: { size: mobile ? 10 : 11 },
        color: CHART_COLORS.text,
      },
    },
    y: {
      grid: { color: CHART_COLORS.grid },
      ticks: {
        font: { size: mobile ? 10 : 11 },
        color: CHART_COLORS.text,
        callback: (v) => formatCurrency(Number(v)),
      },
    },
  };
}

export function barChartOptions(title: string, horizontal = false): ChartOptions {
  const mobile = isMobileChart();
  const opts: ChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: mobile ? 400 : 700 },
    plugins: {
      ...basePlugins(title, false),
      tooltip: {
        ...basePlugins(title, false)?.tooltip,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatCurrency(Number(ctx.parsed.y ?? 0))}`,
        },
      },
    },
    scales: baseScales(true),
  };
  if (horizontal) {
    opts.indexAxis = 'y';
    opts.plugins!.tooltip!.callbacks = {
      label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatCurrency(Number(ctx.parsed.x ?? 0))}`,
    };
    opts.scales = {
      x: {
        grid: { color: CHART_COLORS.grid },
        ticks: {
          font: { size: mobile ? 10 : 11 },
          callback: (v) => formatCurrency(Number(v)),
        },
      },
      y: {
        grid: { display: false },
        ticks: { font: { size: mobile ? 10 : 11 }, autoSkip: false },
      },
    };
  }
  return opts;
}

export function comboChartOptions(title: string): ChartOptions {
  const mobile = isMobileChart();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: mobile ? 400 : 700 },
    plugins: {
      ...basePlugins(title, true),
      tooltip: {
        ...basePlugins(title, true)?.tooltip,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y ?? 0))}`,
        },
      },
    },
    scales: baseScales(true),
  };
}

export function lineChartOptions(title: string): ChartOptions {
  const mobile = isMobileChart();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: mobile ? 400 : 700 },
    plugins: {
      ...basePlugins(title, false),
      tooltip: {
        ...basePlugins(title, false)?.tooltip,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y ?? 0))}`,
        },
      },
    },
    scales: baseScales(true),
    elements: { point: { radius: mobile ? 2 : 3, hoverRadius: 5 } },
  };
}

export function doughnutChartOptions(title: string): ChartOptions<'doughnut'> {
  const mobile = isMobileChart();
  const plugins = basePlugins(title, true);
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '55%',
    animation: { duration: mobile ? 400 : 700 },
    plugins: {
      title: plugins?.title,
      legend: plugins?.legend,
      tooltip: {
        backgroundColor: '#1a1d29',
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
        padding: 12,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => {
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + b, 0);
            const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
            const label = ctx.label ?? '';
            return `${label}: ${ctx.parsed.toLocaleString()} (${pct}%)`;
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
    animation: { duration: mobile ? 400 : 700 },
    plugins: {
      title: {
        display: true,
        text: title,
        font: { size: mobile ? 13 : 15, weight: 'bold' },
        color: '#1a1d29',
      },
      legend: {
        display: true,
        position: mobile ? 'bottom' : 'right',
        labels: { boxWidth: 12, padding: mobile ? 8 : 12, font: { size: mobile ? 10 : 11 } },
      },
      tooltip: {
        backgroundColor: '#1a1d29',
        padding: 12,
        cornerRadius: 8,
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
  if (config.type === 'line' || config.type === 'bar') {
    config.options = config.options ?? {};
    config.options.plugins = config.options.plugins ?? {};
    (config.options.plugins as Record<string, unknown>)['decimation'] = {
      enabled: true,
      algorithm: 'lttb',
      samples: 50,
    };
  }
  return config;
}
