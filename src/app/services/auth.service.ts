import { Injectable, inject, signal } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  GoogleAuthProvider,
  User,
  browserLocalPersistence,
  getRedirectResult,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private initPromise: Promise<void> | null = null;

  readonly user = toSignal(authState(this.auth), { initialValue: null as User | null });
  readonly user$ = toObservable(this.user);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  whenReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    await setPersistence(this.auth, browserLocalPersistence);
    try {
      await getRedirectResult(this.auth);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    }
    await this.auth.authStateReady();
  }

  async signInWithGoogle(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.whenReady();
      const provider = new GoogleAuthProvider();

      if (this.useRedirectSignIn()) {
        await signInWithRedirect(this.auth, provider);
        return;
      }

      await signInWithPopup(this.auth, provider);
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

  get currentUser(): User | null {
    return this.auth.currentUser;
  }

  async getIdToken(): Promise<string | null> {
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }

  private useRedirectSignIn(): boolean {
    return !['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
