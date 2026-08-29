import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.whenReady();
  return authService.hasAccess ? true : router.createUrlTree(['/login']);
};

export const loginGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.whenReady();
  return authService.hasAccess ? router.createUrlTree(['/']) : true;
};
