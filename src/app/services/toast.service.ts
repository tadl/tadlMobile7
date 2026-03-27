import { Injectable } from '@angular/core';
import { ToastButton, ToastController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(private toastController: ToastController) {}

  async presentToast(
    message: string,
    duration: number = 3500,
    buttons?: ToastButton[],
  ) {
    const toast = await this.toastController.create({
      message: this.normalizeMessage(message),
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
}
