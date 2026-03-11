import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: true,
  selector: 'app-melcat-manage-modal',
  templateUrl: './melcat-manage-modal.component.html',
  styleUrls: ['./melcat-manage-modal.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class MelcatManageModalComponent implements OnInit {
  @Input() type: 'hold' | 'checkout' = 'hold';
  @Input() title = '';
  @Input() author = '';
  @Input() format = '';
  melcatId = '';

  constructor(
    public globals: Globals,
    private modalCtrl: ModalController,
    private toast: ToastService,
    private auth: AuthService,
  ) {}

  ngOnInit() {
    const snap = this.auth.snapshot();
    this.melcatId = (
      snap?.profile?.melcat_id ??
      snap?.profile?.username ??
      snap?.profile?.unique_ils_id ??
      ''
    ).toString().trim();
  }

  async close() {
    await this.modalCtrl.dismiss();
    this.globals.modal_open = false;
  }

  async openMyMelcat() {
    await this.globals.open_external_page(this.globals.my_melcat_url);
    await this.close();
  }

  async copyMelcatId() {
    const value = (this.melcatId ?? '').toString().trim();
    if (!value) {
      this.toast.presentToast('No MeLCat ID available to copy.');
      return;
    }

    const copied = await this.copyText(value);
    if (copied) {
      this.toast.presentToast('MeLCat ID copied.');
    } else {
      this.toast.presentToast('Could not copy MeLCat ID.');
    }
  }

  private async copyText(value: string): Promise<boolean> {
    const text = (value ?? '').toString();
    if (!text) return false;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to textarea fallback.
    }

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
