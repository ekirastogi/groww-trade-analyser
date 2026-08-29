import { bootstrapApplication } from '@angular/platform-browser';
import { buildAppConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { resolveFirebaseConfig } from './environments/firebase.config.resolver';

bootstrapApplication(AppComponent, buildAppConfig(resolveFirebaseConfig()));
