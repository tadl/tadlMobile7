import { CommonModule } from '@angular/common';
import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { IonicModule } from '@ionic/angular/lazy';
import { ModalController } from '@ionic/angular/lazy';
import { Subscription, finalize } from 'rxjs';

import { Globals } from '../../globals';
import {
  EventsService,
  MobileEvent,
  VenueOption,
} from '../../services/events.service';
import { EventDetailComponent } from './event-detail/event-detail.component';
import { APP_PROFILE } from '../../app-profile';

type VenueSelection = 'all' | number; // what EventsService expects
type VenueCode = 'all' | string; // what ion-select uses (string codes)

@Component({
  standalone: true,
  selector: 'app-events',
  templateUrl: './events.page.html',
  styleUrls: ['./events.page.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [CommonModule, IonicModule],
})
export class EventsPage implements OnInit, OnDestroy {
  globals = inject(Globals);
  private eventsService = inject(EventsService);
  private modalController = inject(ModalController);

  loading = true;
  error: string | null = null;

  venues: VenueOption[] = [];

  // Keep the ion-select bound value as a string code
  // (because ion-select works best with strings)
  selectedVenueCode: VenueCode = 'all';

  events: MobileEvent[] = [];

  private activeRequest?: Subscription;
  private requestRevision = 0;
  private loadedVenue: VenueSelection | null = null;
  private destroyed = false;

  readonly placeholderImage = 'assets/placeholder.png';
  readonly showVenueFilter = APP_PROFILE.events.venueFilter;

  ngOnInit(): void {
    this.load('all');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.requestRevision += 1;
    this.activeRequest?.unsubscribe();
  }

  refresh(event: CustomEvent): void {
    const refresher = event.target as HTMLIonRefresherElement | null;
    this.load(
      this.toVenueSelection(this.selectedVenueCode),
      refresher ?? undefined
    );
  }

  onVenueChange(value: any): void {
    const code = (value ?? 'all').toString();
    this.selectedVenueCode = code === 'all' ? 'all' : code;
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

  isCancelled(ev: MobileEvent): boolean {
    return (
      (ev?.moderation_state ?? '').toString().trim().toLowerCase() ===
      'cancelled'
    );
  }

  venueLabel(v: VenueOption): string {
    const code = (v as any)?.code?.toString?.() ?? '';
    if (code === 'all') return 'All Locations';
    const name = ((v as any)?.name ?? '').toString().trim();
    return name === 'Traverse City' ? 'Woodmere' : name;
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

  private load(
    venue: VenueSelection,
    refresher?: HTMLIonRefresherElement
  ): void {
    if (this.destroyed) return;
    const revision = ++this.requestRevision;
    this.activeRequest?.unsubscribe();
    if (this.loadedVenue !== venue) {
      this.events = [];
      this.loadedVenue = null;
    }
    this.loading = this.loadedVenue !== venue;
    this.error = null;
    const isCurrent = () => !this.destroyed && this.requestRevision === revision;

    this.activeRequest = this.eventsService
      .getEvents(venue)
      .pipe(finalize(() => {
        if (isCurrent()) this.loading = false;
        refresher?.complete();
      }))
      .subscribe({
        next: (res) => {
          if (!isCurrent()) return;
          const apiVenues = (res.all_venues || []) as VenueOption[];

          // Ensure only ONE "all" option in the UI.
          const hasAll = apiVenues.some(
            (v: any) => (v?.code ?? '').toString() === 'all'
          );
          this.venues = hasAll
            ? apiVenues
            : (
                [{ code: 'all', name: 'All Locations' } as any] as VenueOption[]
              ).concat(apiVenues);

          // If our selected code is no longer present, reset to 'all'
          const selectedExists =
            this.selectedVenueCode === 'all' ||
            this.venues.some(
              (v: any) => (v?.code ?? '').toString() === this.selectedVenueCode
            );
          if (!selectedExists) this.selectedVenueCode = 'all';

          this.events = (res.events || []).slice().sort((a, b) => {
            const da = new Date(
              (a.start_date || '').replace(' ', 'T')
            ).getTime();
            const db = new Date(
              (b.start_date || '').replace(' ', 'T')
            ).getTime();
            return da - db;
          });

          this.loadedVenue = venue;
          this.loading = false;
        },
        error: () => {
          if (!isCurrent()) return;
          this.error = this.loadedVenue === venue && this.events.length
            ? 'Could not refresh events. Showing saved events.'
            : 'Could not load events. Please try again.';
          this.loading = false;
        },
      });
  }
}
