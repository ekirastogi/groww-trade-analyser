import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AvgCalculatorComponent } from './avg-calculator.component';

type UtilsTab = 'avg';

@Component({
  selector: 'app-utils',
  standalone: true,
  imports: [CommonModule, AvgCalculatorComponent],
  templateUrl: './utils.component.html',
})
export class UtilsComponent {
  readonly tabs: { id: UtilsTab; label: string }[] = [{ id: 'avg', label: 'Avg calculator' }];
  activeTab = signal<UtilsTab>('avg');

  setTab(id: UtilsTab): void {
    this.activeTab.set(id);
  }
}
