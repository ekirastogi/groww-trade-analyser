import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  GoogleAuthProvider,
  User,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ACCESS_DENIED_MESSAGE, isAllowedGoogleUser } from '../constants/allowed-users';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private initPromise: Promise<void> | null = null;

  readonly user = toSignal(authState(this.auth), { initialValue: null as User | null });
  readonly user$ = toObservable(this.user);
  readonly sessionAllowed = computed(() => isAllowedGoogleUser(this.user()));
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  whenReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    try {
      await getRedirectResult(this.auth);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    }
    await this.auth.authStateReady();
    await this.rejectIfNotAllowed();
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
      await this.rejectIfNotAllowed();
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
    return this.hasAccess ? (this.auth.currentUser?.uid ?? null) : null;
  }

  get currentUser(): User | null {
    const user = this.auth.currentUser;
    return isAllowedGoogleUser(user) ? user : null;
  }

  get hasAccess(): boolean {
    return isAllowedGoogleUser(this.auth.currentUser);
  }

  async getIdToken(): Promise<string | null> {
    if (!this.hasAccess) return null;
    return (await this.auth.currentUser?.getIdToken()) ?? null;
  }

  private async rejectIfNotAllowed(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;
    if (isAllowedGoogleUser(user)) return;
    await signOut(this.auth);
    this.error.set(ACCESS_DENIED_MESSAGE);
  }

  private useRedirectSignIn(): boolean {
    return !['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
