import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { BrandLogoComponent } from '../shared/brand-logo/brand-logo.component';
import { BRAND } from '../../constants/brand';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, BrandLogoComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  readonly brand = BRAND;
  readonly year = new Date().getFullYear();
}
