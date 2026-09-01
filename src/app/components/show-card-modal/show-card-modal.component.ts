import {
  AfterViewInit,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';

import { IonicModule, ModalController } from '@ionic/angular/lazy';

import { Globals } from '../../globals';

// JsBarcode has ESM exports; TS sometimes sees it as any. That’s fine for now.
import JsBarcode from 'jsbarcode';

@Component({
  standalone: true,
  selector: 'app-show-card-modal',
  templateUrl: './show-card-modal.component.html',
  styleUrls: ['./show-card-modal.component.scss'],
  imports: [IonicModule],
})
export class ShowCardModalComponent implements AfterViewInit, OnChanges {
  globals = inject(Globals);
  private modalController = inject(ModalController);

  @Input() barcode!: string;

  // optional: show the MeLCat username/id under the barcode
  @Input() melcatId?: string;

  close() {
    this.modalController.dismiss();
    this.globals.modal_open = false;
  }

  ngAfterViewInit(): void {
    this.renderBarcode();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['barcode'] && !changes['barcode'].firstChange) {
      this.renderBarcode();
    }
  }

  private renderBarcode() {
    const value = (this.barcode ?? '').toString().trim();
    if (!value) return;

    // The SVG element exists after view init
    const el = document.getElementById('library-card-barcode');
    if (!el) return;

    try {
      JsBarcode(el, value, {
        format: 'CODE128',
        displayValue: true,
        margin: 10,
        // Keep it scannable: solid black bars on white background.
        lineColor: '#000000',
        background: '#FFFFFF',
        font: 'monospace',
        fontSize: 18,
        textMargin: 6,
        height: 90,
      });
    } catch (e) {
      // If something goes wrong, we still don’t want the modal to explode.
      console.warn('[ShowCardModal] failed to render barcode', e);
    }
  }
}
