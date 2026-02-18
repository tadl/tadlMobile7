import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ModalController } from '@ionic/angular/standalone';
import { Subject, takeUntil } from 'rxjs';

import { Globals } from '../../globals';
import { EventsService, MobileEvent, VenueOption } from '../../services/events.service';
import { EventDetailComponent } from './event-detail/event-detail.component';

type VenueSelection = 'all' | number; // what EventsService expects
type VenueCode = 'all' | string;      // what ion-select uses (string codes)

@Component({
  standalone: true,
  selector: 'app-events',
  templateUrl: './events.page.html',
  styleUrls: ['./events.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class EventsPage implements OnInit, OnDestroy {
  loading = true;
  error: string | null = null;

  venues: VenueOption[] = [];

  // Keep the ion-select bound value as a string code
  // (because ion-select works best with strings)
  selectedVenueCode: VenueCode = 'all';

  events: MobileEvent[] = [];

  private destroyed$ = new Subject<void>();

  readonly placeholderImage = 'assets/placeholder.png';

  constructor(
    public globals: Globals,
    private eventsService: EventsService,
    private modalController: ModalController,
  ) {}

  ngOnInit(): void {
    this.load('all');
  }

  ngOnDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
  }

  onVenueChange(value: any): void {
    const code = (value ?? 'all').toString();
    this.selectedVenueCode = (code === 'all' ? 'all' : code);
    this.load(this.toVenueSelection(this.selectedVenueCode));
  }

  trackByUrl(_: number, ev: MobileEvent): string {
    return ev.url;
  }

  imageFor(ev: MobileEvent): string {
    return ev.image || this.placeholderImage;
  }

  titleFor(ev: MobileEvent): string {
    return (ev.title || 'Event').toString();
  }

  venueLabel(v: VenueOption): string {
    const code = (v as any)?.code?.toString?.() ?? '';
    if (code === 'all') return 'All Locations';
    return (v as any)?.name ?? '';
  }

  venueValue(v: VenueOption): string {
    const code = (v as any)?.code?.toString?.();
    return code || '';
  }

  async openEvent(ev: MobileEvent): Promise<void> {
    const modal = await this.modalController.create({
      component: EventDetailComponent,
      componentProps: {
        event: ev,
        dismissStyle: 'close',
      },
    });
    this.globals.modal_open = true;
    modal.onDidDismiss().then(() => (this.globals.modal_open = false));
    await modal.present();
  }

  private toVenueSelection(code: VenueCode): VenueSelection {
    if (code === 'all') return 'all';
    const n = Number(code);
    return Number.isFinite(n) ? n : 'all';
  }

  private load(venue: VenueSelection): void {
    this.loading = true;
    this.error = null;

    this.eventsService
      .getEvents(venue)
      .pipe(takeUntil(this.destroyed$))
      .subscribe({
        next: (res) => {
          const apiVenues = (res.all_venues || []) as VenueOption[];

          // Ensure only ONE "all" option in the UI.
          const hasAll = apiVenues.some((v: any) => (v?.code ?? '').toString() === 'all');
          this.venues = hasAll
            ? apiVenues
            : ([{ code: 'all', name: 'All Locations' } as any] as VenueOption[]).concat(apiVenues);

          // If our selected code is no longer present, reset to 'all'
          const selectedExists =
            this.selectedVenueCode === 'all' ||
            this.venues.some((v: any) => (v?.code ?? '').toString() === this.selectedVenueCode);
          if (!selectedExists) this.selectedVenueCode = 'all';

          this.events = (res.events || []).slice().sort((a, b) => {
            const da = new Date((a.start_date || '').replace(' ', 'T')).getTime();
            const db = new Date((b.start_date || '').replace(' ', 'T')).getTime();
            return da - db;
          });

          this.loading = false;
        },
        error: (err) => {
          console.error(err);
          this.error = 'Could not load events. Please try again.';
          this.loading = false;
        },
      });
  }
}
