import { APP_INITIALIZER, ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FirebaseOptions, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';

import { routes } from './app.routes';
import { AuthService } from './services/auth.service';
import { SupabaseService } from './services/supabase.service';

export function buildAppConfig(firebase: FirebaseOptions): ApplicationConfig {
  return {
    providers: [
      provideRouter(routes),
      provideAnimations(),
      provideFirebaseApp(() => initializeApp(firebase)),
      provideAuth(() => {
        const app = getApp();
        try {
          return initializeAuth(app, {
            persistence: indexedDBLocalPersistence,
            popupRedirectResolver: browserPopupRedirectResolver,
          });
        } catch {
          return getAuth(app);
        }
      }),
      provideFirestore(() => getFirestore()),
      provideFunctions(() => getFunctions(getApp(), 'asia-south1')),
      {
        provide: APP_INITIALIZER,
        useFactory: (supabase: SupabaseService, authService: AuthService) => async () => {
          await supabase.whenReady();
          await authService.whenReady();
        },
        deps: [SupabaseService, AuthService],
        multi: true,
      },
    ],
  };
}
