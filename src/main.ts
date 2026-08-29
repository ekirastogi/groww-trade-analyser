import { bootstrapApplication } from '@angular/platform-browser';
import { buildAppConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { firebaseConfig } from './environments/firebase.config';

bootstrapApplication(AppComponent, buildAppConfig(firebaseConfig));
