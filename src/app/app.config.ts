import { APP_INITIALIZER, ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FirebaseOptions, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

import { routes } from './app.routes';
import { AuthService } from './services/auth.service';

export function buildAppConfig(firebase: FirebaseOptions): ApplicationConfig {
  return {
    providers: [
      provideRouter(routes),
      provideAnimations(),
      provideFirebaseApp(() => initializeApp(firebase)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
      {
        provide: APP_INITIALIZER,
        multi: true,
        useFactory: (auth: AuthService) => () => auth.handleRedirectResult(),
        deps: [AuthService],
      },
    ],
  };
}
