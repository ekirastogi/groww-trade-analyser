import { Injectable } from '@angular/core';

/** FCM notifications — configure VAPID key in Firebase console when ready. */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  async requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  show(title: string, body: string): void {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }
}
