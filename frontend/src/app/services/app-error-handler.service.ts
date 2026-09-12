import { ErrorHandler, Injectable, signal } from '@angular/core';

export interface AppErrorEntry {
  message: string;
  at: number;
  stack?: string;
}

/** Keep a short tail of recent errors — enough to diagnose, not enough to leak memory. */
const MAX_RETAINED = 25;

/**
 * Global error sink.
 *
 * Without this, an uncaught template exception or unhandled rejection only ever reaches the
 * devtools console, so a broken deploy is invisible unless someone happens to have devtools
 * open. Errors are retained in memory and surfaced through `latest()` so the shell can show a
 * banner, and re-thrown to the console so stack traces stay inspectable.
 *
 * `report()` is the single place to add an external sink (Sentry, Crashlytics) later.
 */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly entries = signal<AppErrorEntry[]>([]);

  /** Most recent unhandled error, or null once dismissed. */
  readonly latest = signal<AppErrorEntry | null>(null);

  readonly recent = this.entries.asReadonly();

  handleError(error: unknown): void {
    const wrapped = error instanceof Error ? error : new Error(String(error));
    // Angular wraps rejections; the inner error carries the useful message.
    const cause = (wrapped as { rejection?: unknown }).rejection;
    const actual = cause instanceof Error ? cause : wrapped;

    const entry: AppErrorEntry = {
      message: actual.message || 'Something went wrong',
      at: Date.now(),
      stack: actual.stack,
    };

    this.entries.update((list) => [entry, ...list].slice(0, MAX_RETAINED));
    this.latest.set(entry);
    this.report(entry, actual);

    console.error('[unhandled]', actual);
  }

  dismiss(): void {
    this.latest.set(null);
  }

  /** Hook for an external crash reporter. Intentionally a no-op until one is configured. */
  private report(_entry: AppErrorEntry, _error: Error): void {
    // e.g. Sentry.captureException(_error)
  }
}
