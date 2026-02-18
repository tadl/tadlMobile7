import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../../globals';

@Component({
  standalone: true,
  selector: 'app-location-detail',
  templateUrl: './location-detail.component.html',
  styleUrls: ['./location-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class LocationDetailComponent {
  @Input() location: any;

  constructor(
    public globals: Globals,
    private modalController: ModalController,
  ) {}

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  openLink(url?: string) {
    if (url) this.globals.open_page(url);
  }
}
