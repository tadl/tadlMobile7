import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ModalController } from '@ionic/angular';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import type { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-item-page',
  templateUrl: './item.page.html',
  styleUrls: ['./item.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class ItemPage {
  private opened = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private modalCtrl: ModalController,
    private toast: ToastService,
    public globals: Globals,
  ) {}

  async ionViewDidEnter() {
    if (this.opened) return;
    this.opened = true;

    const id = (this.route.snapshot.paramMap.get('id') ?? '').toString().trim();
    if (!id) {
      this.toast.presentToast('Invalid item id.');
      this.goBackOrHome();
      return;
    }

    const hit: AspenSearchHit = {
      key: id,
      title: 'Item Detail',
      author: undefined,
      coverUrl: undefined,
      summary: undefined,
      language: undefined,
      format: undefined,
      itemList: [],
      catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(id)}/Home`,
      raw: undefined,
    };

    const modal = await this.modalCtrl.create({
      component: ItemDetailComponent,
      componentProps: { hit },
    });

    this.globals.modal_open = true;
    modal.onDidDismiss().then(() => {
      this.globals.modal_open = false;
      this.goBackOrHome();
    });

    await modal.present();
  }

  private goBackOrHome() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    void this.router.navigateByUrl('/home');
  }
}

