import { Component } from '@angular/core';
import { AvgCalculatorComponent } from './avg-calculator.component';

@Component({
  selector: 'app-utils',
  standalone: true,
  imports: [AvgCalculatorComponent],
  template: `<app-avg-calculator />`,
})
export class UtilsComponent {}
