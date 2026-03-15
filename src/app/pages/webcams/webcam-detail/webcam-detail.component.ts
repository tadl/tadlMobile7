import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IonicModule, ModalController } from '@ionic/angular';

import { Globals } from '../../../globals';

export interface WebcamStreamViewModel {
  title: string;
  subtitle: string;
  youtubeUrl: string;
  embedUrl: string;
}

@Component({
  standalone: true,
  selector: 'app-webcam-detail',
  templateUrl: './webcam-detail.component.html',
  styleUrls: ['./webcam-detail.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class WebcamDetailComponent {
  @Input() webcam?: WebcamStreamViewModel;

  constructor(
    public globals: Globals,
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
  ) {}

  titleFor(): string {
    return (this.webcam?.title ?? '').toString().trim() || 'Webcam';
  }

  subtitleFor(): string {
    return (this.webcam?.subtitle ?? '').toString().trim();
  }

  embedUrl(): SafeResourceUrl | null {
    const url = (this.webcam?.embedUrl ?? '').toString().trim();
    if (!url) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }

  async close() {
    await this.modalController.dismiss();
  }
}
