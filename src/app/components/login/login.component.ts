import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg text-center">
        <div class="mb-2 text-4xl">📈</div>
        <h1 class="text-2xl font-bold text-slate-900">Groww Trader</h1>
        <p class="mt-2 text-sm text-slate-500">Sign in to view recommendations, your trade data, and upload reports.</p>
        <p class="mt-1 text-xs text-slate-400">Session stays signed in on this device until you log out.</p>
        @if (auth.error()) {
          <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ auth.error() }}</div>
        }
        <button
          type="button"
          class="mt-6 w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          [disabled]="auth.loading()"
          (click)="auth.signInWithGoogle()"
        >
          {{ auth.loading() ? 'Signing in...' : 'Continue with Google' }}
        </button>
      </div>
    </div>
  `,
})
export class LoginComponent {
  readonly auth = inject(AuthService);
}
