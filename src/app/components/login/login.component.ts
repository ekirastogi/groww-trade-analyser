import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { BrandLogoComponent } from '../shared/brand-logo/brand-logo.component';
import { BRAND } from '../../constants/brand';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, BrandLogoComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  readonly auth = inject(AuthService);
  private router = inject(Router);
  readonly brand = BRAND;
  readonly year = new Date().getFullYear();
  checkingSession = true;

  async ngOnInit(): Promise<void> {
    await this.auth.whenReady();
    this.checkingSession = false;
    if (this.auth.currentUser) {
      await this.router.navigate(['/']);
    }
  }
}
