import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { WebcamFeedItem, WebcamsService } from '../../services/webcams.service';

interface WebcamStreamViewModel {
  title: string;
  subtitle: string;
  youtubeUrl: string;
}

@Component({
  standalone: true,
  selector: 'app-webcams',
  templateUrl: './webcams.page.html',
  styleUrls: ['./webcams.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class WebcamsPage implements OnInit {
  webcams: WebcamStreamViewModel[] = [];
  loading = false;

  constructor(
    public globals: Globals,
    private webcamsService: WebcamsService,
  ) {}

  ngOnInit() {
    this.refresh();
  }

  ionViewWillEnter() {
    this.refresh();
  }

  refresh(event?: CustomEvent) {
    this.loading = true;
    this.webcamsService
      .getWebcams()
      .pipe(finalize(() => {
        this.loading = false;
        event?.detail?.complete?.();
      }))
      .subscribe({
        next: (items) => {
          this.webcams = items.map((item) => this.toStream(item));
        },
        error: () => {
          this.webcams = [];
        },
      });
  }

  private toStream(item: WebcamFeedItem): WebcamStreamViewModel {
    return {
      title: item.title,
      subtitle: (item.subtitle ?? '').toString().trim(),
      youtubeUrl: item.youtube_url,
    };
  }

  async openWebcam(webcam: WebcamStreamViewModel) {
    return await this.globals.open_page(webcam.youtubeUrl);
  }
}
