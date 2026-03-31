import { Injectable } from '@angular/core';
import { ToastButton, ToastController } from '@ionic/angular';
import { ServiceAlertService } from './service-alert.service';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(
    private toastController: ToastController,
    private serviceAlerts: ServiceAlertService,
  ) {}

  async presentToast(
    message: string,
    duration: number = 3500,
    buttons?: ToastButton[],
  ) {
    const normalizedMessage = this.normalizeMessage(message);
    const finalMessage = this.withServiceAlertIfNeeded(normalizedMessage);

    const toast = await this.toastController.create({
      message: finalMessage,
      duration,
      position: 'bottom',
      buttons,
    });
    await toast.present();
  }

  async presentHoldPlacedToast(
    message: string = 'Hold placed.',
    onManage?: () => void | Promise<void>,
  ) {
    const buttons: ToastButton[] = onManage
      ? [
          {
            text: 'Manage',
            side: 'end',
            handler: () => {
              void onManage();
            },
          },
        ]
      : [];

    await this.presentToast(message, 5000, buttons);
  }

  private normalizeMessage(message: string): string {
    return (message ?? '')
      .toString()
      .trim()
      .replace(/\s+([,.;!?])/g, '$1')
      .replace(/[,;:]+\s*$/g, '')
      .trim();
  }

  private withServiceAlertIfNeeded(message: string): string {
    const base = this.normalizeMessage(message);
    const alert = this.normalizeMessage(this.serviceAlerts.snapshot() ?? '');
    if (!base || !alert) return base;
    if (!this.shouldAppendServiceAlert(base)) return base;

    const lowerBase = base.toLowerCase();
    const lowerAlert = alert.toLowerCase();
    if (lowerBase.includes(lowerAlert)) return base;

    return `${base}\n\n${alert}`;
  }

  private shouldAppendServiceAlert(message: string): boolean {
    const lower = (message ?? '').toLowerCase();
    return [
      'could not',
      'failed',
      'failure',
      'error',
      'unsuccessful',
      'unable to',
      'try again',
      'missing account credentials',
      'login failed',
      'not available',
      'invalid',
      'rate-limited',
    ].some((needle) => lower.includes(needle));
  }
}
