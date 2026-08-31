import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import {
  GoogleAuthProvider,
  User,
  UserCredential,
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
  private dataUserIdSignal = signal<string | null>(null);

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
        await this.signInSupabaseFromCredential(result);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    }
    await this.auth.authStateReady();
    await this.supabase.whenReady();
    await this.refreshDataUserId();
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

      const result = await signInWithPopup(this.auth, provider);
      await this.signInSupabaseFromCredential(result);
      await this.rejectIfNotAllowed();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    this.dataUserIdSignal.set(null);
    await this.supabase.client.auth.signOut();
    await signOut(this.auth);
  }

  /** Firebase uid — used only for Firestore worker paths. */
  get uid(): string | null {
    return this.hasAccess ? (this.auth.currentUser?.uid ?? null) : null;
  }

  /** Supabase auth uid — use for all Postgres data tables. */
  get dataUserId(): string | null {
    return this.hasAccess ? this.dataUserIdSignal() : null;
  }

  async getDataUserId(): Promise<string | null> {
    await this.whenReady();
    if (!this.hasAccess) return null;
    if (this.dataUserIdSignal()) return this.dataUserIdSignal();
    return this.refreshDataUserId();
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

  private async signInSupabaseFromCredential(result: UserCredential): Promise<void> {
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.idToken) return;
    const { error } = await this.supabase.client.auth.signInWithIdToken({
      provider: 'google',
      token: credential.idToken,
    });
    if (error) {
      console.warn('Supabase sign-in failed:', error.message);
      return;
    }
    await this.refreshDataUserId();
  }

  private async refreshDataUserId(): Promise<string | null> {
    const id = await this.supabase.getUserId();
    this.dataUserIdSignal.set(id);
    return id;
  }

  private async rejectIfNotAllowed(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) return;
    if (isAllowedGoogleUser(user)) return;
    this.dataUserIdSignal.set(null);
    await this.supabase.client.auth.signOut();
    await signOut(this.auth);
    this.error.set(ACCESS_DENIED_MESSAGE);
  }

  private useRedirectSignIn(): boolean {
    return !['localhost', '127.0.0.1'].includes(window.location.hostname);
  }
}
