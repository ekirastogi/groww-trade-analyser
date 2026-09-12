import { Component, input } from '@angular/core';

/**
 * Load-failure notice.
 *
 * Pages that only branched on "is there a report?" rendered an upload prompt when a fetch
 * failed, which told people with months of history that they had no data. Rendering this above
 * the empty state keeps a failure visually distinct from genuinely having nothing.
 */
@Component({
  selector: 'app-error-banner',
  standalone: true,
  template: `
    @if (message()) {
      <div
        class="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        role="alert"
      >
        <span class="mt-0.5 shrink-0 font-bold">!</span>
        <div>
          <p class="font-semibold">{{ title() }}</p>
          <p class="mt-0.5 text-red-600">{{ message() }}</p>
        </div>
      </div>
    }
  `,
})
export class ErrorBannerComponent {
  message = input<string | null>(null);
  title = input('Could not load your data');
}
