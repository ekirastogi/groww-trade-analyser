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
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = inject(Auth);
  private supabase = inject(SupabaseService);
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
      const result = await getRedirectResult(this.auth);
      if (result) {
        await this.refreshFirebaseToken(true);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    }
    await this.auth.authStateReady();
    await this.supabase.whenReady();
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
      await this.refreshFirebaseToken(true);
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

  /** Firebase uid — used for Firestore worker paths and Supabase user_id columns. */
  get uid(): string | null {
    return this.hasAccess ? (this.auth.currentUser?.uid ?? null) : null;
  }

  /** Same as Firebase uid when using Supabase Firebase Third-Party Auth. */
  get dataUserId(): string | null {
    return this.uid;
  }

  async getDataUserId(): Promise<string | null> {
    await this.whenReady();
    return this.uid;
  }

  get currentUser(): User | null {
    const user = this.auth.currentUser;
    return isAllowedGoogleUser(user) ? user : null;
  }

  get hasAccess(): boolean {
    return isAllowedGoogleUser(this.auth.currentUser);
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    if (!this.hasAccess) return null;
    return (await this.auth.currentUser?.getIdToken(forceRefresh)) ?? null;
  }

  /** Force-refresh Firebase JWT so Supabase sees role: authenticated custom claim. */
  private async refreshFirebaseToken(forceRefresh: boolean): Promise<void> {
    if (!this.auth.currentUser) return;
    await this.auth.currentUser.getIdToken(forceRefresh);
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
