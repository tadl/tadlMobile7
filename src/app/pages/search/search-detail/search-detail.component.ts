import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Globals } from '../../../globals';
import { AspenSearchHit } from '../../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-search-detail',
  templateUrl: './search-detail.component.html',
  styleUrls: ['./search-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class SearchDetailComponent {
  @Input() hit!: AspenSearchHit;

  constructor(
    public globals: Globals,
    private modalController: ModalController,
  ) {}

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  openCatalog() {
    if (this.hit?.catalogUrl) this.globals.open_page(this.hit.catalogUrl);
  }
}
