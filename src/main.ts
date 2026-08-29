import { bootstrapApplication } from '@angular/platform-browser';
import { buildAppConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { loadFirebaseConfig } from './app/config/firebase-config.loader';

loadFirebaseConfig()
  .then((firebase) => bootstrapApplication(AppComponent, buildAppConfig(firebase)))
  .catch((err) => console.error(err));
