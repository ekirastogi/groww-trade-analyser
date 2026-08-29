import { Injectable, inject, signal } from '@angular/core';
import {
  Auth,
  GoogleAuthProvider,
  User,
  authState,
  signInWithPopup,
  signOut,
} from '@angular/fire/auth';
import { toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private provider = new GoogleAuthProvider();

  readonly user = toSignal(authState(this.auth), { initialValue: null as User | null });
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async signInWithGoogle(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await signInWithPopup(this.auth, this.provider);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  async getIdToken(): Promise<string | null> {
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }
}
