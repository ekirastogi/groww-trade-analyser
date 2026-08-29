import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { FirebaseOptions, initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

import { routes } from './app.routes';

export function buildAppConfig(firebase: FirebaseOptions): ApplicationConfig {
  return {
    providers: [
      provideRouter(routes),
      provideAnimations(),
      provideFirebaseApp(() => initializeApp(firebase)),
      provideAuth(() => getAuth()),
      provideFirestore(() => getFirestore()),
    ],
  };
}
