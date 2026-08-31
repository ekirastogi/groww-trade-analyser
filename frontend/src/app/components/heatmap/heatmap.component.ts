import {
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReportStateService } from '../../services/report-state.service';
import { FilteredStockService } from '../../services/filtered-stock.service';
import { StockSummary } from '../../models/trade.models';
import { formatCurrency } from '../../utils/format.utils';
import { normalizeSymbol } from '../../utils/upload-merge.utils';
import { layoutTreemap, minRectDimension, rectToPercentStyle } from '../../utils/treemap.utils';
import { TradeTypeFilterComponent } from '../shared/trade-type-filter/trade-type-filter.component';

const HEATMAP_HEIGHT_PX = 500;
const PANE_HEADER_PX = 32;
const GRID_GAP_PX = 4;
const GRID_PADDING_PX = 16;
const MIN_TILE_PX = 56;

interface HeatmapTile {
  symbol: string;
  name: string;
  netPnL: number;
  background: string;
  borderColor: string;
  textColor: string;
  style: Record<string, string>;
}

interface HeatmapOthers {
  count: number;
  netPnL: number;
  symbols: string[];
  background: string;
  borderColor: string;
  textColor: string;
  style: Record<string, string>;
}

interface HeatmapColors {
  background: string;
  borderColor: string;
  textColor: string;
}

interface HeatmapSection {
  featured: HeatmapTile[];
  others: HeatmapOthers | null;
  total: number;
  stockCount: number;
}

@Component({
  selector: 'app-heatmap',
  standalone: true,
  imports: [CommonModule, RouterLink, TradeTypeFilterComponent],
  templateUrl: './heatmap.component.html',
})
export class HeatmapComponent implements OnInit {
  readonly reportState = inject(ReportStateService);
  readonly filteredStocks = inject(FilteredStockService);
  readonly fmt = formatCurrency;
  readonly heatmapHeight = HEATMAP_HEIGHT_PX;

  private columnsEl = viewChild<ElementRef<HTMLElement>>('columnsEl');
  private paneWidth = signal(0);
  private paneHeight = signal(0);

  private stockRows = computed((): StockSummary[] => this.filteredStocks.stocks());

  profitableSection = computed(() =>
    this.buildSection(this.stockRows().filter((s) => s.netPnL > 0), true)
  );

  losingSection = computed(() =>
    this.buildSection(this.stockRows().filter((s) => s.netPnL < 0), false)
  );

  constructor() {
    effect((onCleanup) => {
      const el = this.columnsEl()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() => this.updatePaneSize(el));
      observer.observe(el);
      this.updatePaneSize(el);
      onCleanup(() => observer.disconnect());
    }, { allowSignalWrites: true });
  }

  async ngOnInit(): Promise<void> {
    await this.reportState.ensureLoadedFromFirebase();
  }

  othersTooltip(symbols: string[]): string {
    if (symbols.length <= 8) return symbols.join(', ');
    return `${symbols.slice(0, 8).join(', ')} +${symbols.length - 8} more`;
  }

  private updatePaneSize(el: HTMLElement): void {
    const paneWidth = Math.max(0, el.clientWidth / 2 - 1);
    const innerHeight = HEATMAP_HEIGHT_PX - PANE_HEADER_PX - GRID_PADDING_PX;
    const innerWidth = Math.max(0, paneWidth - GRID_PADDING_PX);
    this.paneWidth.set(innerWidth);
    this.paneHeight.set(innerHeight);
  }

  private buildSection(stocks: StockSummary[], positive: boolean): HeatmapSection {
    const sorted = [...stocks].sort((a, b) => (positive ? b.netPnL - a.netPnL : a.netPnL - b.netPnL));
    const total = sorted.reduce((sum, s) => sum + s.netPnL, 0);
    const width = this.paneWidth();
    const height = this.paneHeight();

    if (!sorted.length || width <= 0 || height <= 0) {
      return { featured: [], others: null, total, stockCount: sorted.length };
    }

    const max = Math.max(...sorted.map((s) => Math.abs(s.netPnL)), 1);
    const { featured, rest } = this.splitForReadableLayout(sorted, width, height);
    const weights = featured.map((stock) => Math.abs(stock.netPnL));
    if (rest.length) {
      weights.push(rest.reduce((sum, stock) => sum + Math.abs(stock.netPnL), 0));
    }

    const rects = layoutTreemap(weights, width, height, GRID_GAP_PX);
    const tiles = featured.map((stock, index) => {
      const colors = this.colorsForRatio(Math.abs(stock.netPnL) / max, positive);
      return {
        symbol: stock.symbol || normalizeSymbol(stock.stockName),
        name: stock.stockName,
        netPnL: stock.netPnL,
        ...colors,
        style: rectToPercentStyle(rects[index], width, height),
      };
    });

    let others: HeatmapOthers | null = null;
    if (rest.length) {
      const netPnL = rest.reduce((sum, s) => sum + s.netPnL, 0);
      const colors = this.colorsForRatio(Math.abs(netPnL) / max, positive);
      others = {
        count: rest.length,
        netPnL,
        symbols: rest.map((s) => s.symbol || normalizeSymbol(s.stockName)),
        ...colors,
        style: rectToPercentStyle(rects[rects.length - 1], width, height),
      };
    }

    return { featured: tiles, others, total, stockCount: sorted.length };
  }

  private splitForReadableLayout(
    sorted: StockSummary[],
    width: number,
    height: number
  ): { featured: StockSummary[]; rest: StockSummary[] } {
    for (let count = sorted.length; count >= 1; count--) {
      const needsOthers = count < sorted.length;
      const featuredCount = needsOthers ? count - 1 : count;
      const featured = sorted.slice(0, featuredCount);
      const rest = needsOthers ? sorted.slice(featuredCount) : [];
      const weights = featured.map((stock) => Math.abs(stock.netPnL));

      if (rest.length) {
        weights.push(rest.reduce((sum, stock) => sum + Math.abs(stock.netPnL), 0));
      }

      const rects = layoutTreemap(weights, width, height, GRID_GAP_PX);
      const smallest = Math.min(...rects.map((rect) => minRectDimension(rect)));

      if (smallest >= MIN_TILE_PX || count === 1) {
        return { featured, rest };
      }
    }

    return { featured: sorted.slice(0, 1), rest: sorted.slice(1) };
  }

  private colorsForRatio(ratio: number, positive: boolean): HeatmapColors {
    const t = Math.pow(Math.min(1, Math.max(0, ratio)), 0.55);

    if (positive) {
      const saturation = Math.round(42 + t * 54);
      const lightness = Math.round(92 - t * 50);
      const borderLightness = Math.max(28, lightness - 10);
      return {
        background: `hsl(152, ${saturation}%, ${lightness}%)`,
        borderColor: `hsl(152, ${saturation}%, ${borderLightness}%)`,
        textColor: lightness <= 58 ? '#ffffff' : '#064e3b',
      };
    }

    const saturation = Math.round(48 + t * 50);
    const lightness = Math.round(92 - t * 50);
    const borderLightness = Math.max(28, lightness - 10);
    return {
      background: `hsl(0, ${saturation}%, ${lightness}%)`,
      borderColor: `hsl(0, ${saturation}%, ${borderLightness}%)`,
      textColor: lightness <= 58 ? '#ffffff' : '#7f1d1d',
    };
  }
}
