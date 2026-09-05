import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvgCalculatorComponent } from './avg-calculator.component';
import { ProfitTargetComponent } from './profit-target.component';
import { ChargesCalculatorComponent } from './charges-calculator.component';
import { readJson, writeJson } from '../../utils/local-store.utils';

type UtilsTab = 'avg' | 'target' | 'charges';

const TAB_STORAGE_KEY = 'kairo-utils-tab-v1';

@Component({
  selector: 'app-utils',
  standalone: true,
  imports: [CommonModule, AvgCalculatorComponent, ProfitTargetComponent, ChargesCalculatorComponent],
  templateUrl: './utils.component.html',
})
export class UtilsComponent {
  readonly tabs: { id: UtilsTab; label: string }[] = [
    { id: 'avg', label: 'Avg calculator' },
    { id: 'target', label: 'Profit target' },
    { id: 'charges', label: 'Charges' },
  ];

  activeTab = signal<UtilsTab>(readJson<UtilsTab>(TAB_STORAGE_KEY, 'avg'));

  setTab(id: UtilsTab): void {
    this.activeTab.set(id);
    writeJson(TAB_STORAGE_KEY, id);
  }
}
