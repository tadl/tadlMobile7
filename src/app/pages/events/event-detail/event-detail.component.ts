import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SecurityContext,
  SimpleChanges,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { IonicModule } from '@ionic/angular';
import { ModalController } from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { Subscription, isObservable, lastValueFrom } from 'rxjs';

import { EventsService } from '../../../services/events.service';
import { Globals } from '../../../globals';

type EventLike = {
  id?: string | number;
  slug?: string;
  title?: string;
  name?: string;

  // API/mobile fields (yours)
  start_date?: string | null;
  end_date?: string | null;
  registration_enabled?: boolean | null;
  registration_type?: string | null;
  registration_start?: string | null;
  registration_end?: string | null;
  moderation_state?: string | null;
  timezone?: string | null;

  // Other common shapes
  startsAt?: string | null;
  endsAt?: string | null;
  start?: string | null;
  end?: string | null;
  allDay?: boolean;

  location?: string | null;
  room?: string | null;
  venue?: string | null;

  description?: string | null;
  summary?: string | null;

  imageUrl?: string | null;
  image?: string | null;

  url?: string | null;
  registrationUrl?: string | null;

  tags?: string[];

  // allow unknown fields
  [key: string]: any;
};

@Component({
  standalone: true,
  selector: 'app-event-detail',
  templateUrl: './event-detail.component.html',
  styleUrls: ['./event-detail.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, IonicModule],
})
export class EventDetailComponent implements OnInit, OnChanges, OnDestroy {
  /** Provide an event object directly (preferred). */
  @Input() event: EventLike | null = null;

  /** Or provide an id/slug and let the component load it. */
  @Input() eventId: string | null = null;

  /** If true, and event/eventId aren't provided, read route params and load. */
  @Input() useRouteParam = false;

  /** Standardize modal dismissal UI: 'close' (top-right) or 'back' (top-left) */
  @Input() dismissStyle: 'close' | 'back' = 'close';

  /** Optional: if used in a non-modal context, parent can handle back */
  @Output() back = new EventEmitter<void>();

  loading = false;
  error: string | null = null;

  private descriptionHtmlCacheRaw: string | null = null;
  private descriptionHtmlCacheValue = '';
  private sub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private eventsService: EventsService,
    private modalController: ModalController,
    private globals: Globals,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    if (!this.useRouteParam) return;

    this.sub = this.route.paramMap.subscribe((pm) => {
      if (this.event || this.eventId) return;

      const id = pm.get('id') || pm.get('eventId') || pm.get('slug');
      this.eventId = id;
      void this.loadIfNeeded();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['event'] && this.event) {
      this.loading = false;
      this.error = null;
    }

    if (changes['eventId']) {
      void this.loadIfNeeded();
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  async dismiss(): Promise<void> {
    // If we're in a modal, dismiss it. Otherwise emit back.
    try {
      await this.modalController.dismiss();
    } catch {
      this.back.emit();
    }
  }

  async openExternalUrl() {
    if (!this.externalUrl) return;
    await this.globals.open_page(this.externalUrl);
  }

  get title(): string {
    return (this.event?.title || this.event?.name || 'Event') as string;
  }

  /**
   * Raw date string (primarily for debugging / legacy checks).
   * Prefer startsAtDate for UI.
   */
  get startsAt(): string | null {
    const e: any = this.event;
    return (
      e?.start_date ??
      e?.startsAt ??
      e?.start ??
      e?.['startTime'] ??
      null
    ) as string | null;
  }

  get endsAt(): string | null {
    const e: any = this.event;
    return (
      e?.end_date ??
      e?.endsAt ??
      e?.end ??
      e?.['endTime'] ??
      null
    ) as string | null;
  }

  get startsAtDate(): Date | null {
    return this.parseDate(this.startsAt);
  }

  get endsAtDate(): Date | null {
    return this.parseDate(this.endsAt);
  }

  get location(): string | null {
    return (
      this.event?.location ||
      (this.event as any)?.venue ||
      null
    ) as string | null;
  }

  get displayRoom(): string | null {
    const location = (this.event?.location ?? '').toString().trim();
    const room = (this.event?.room ?? '').toString().trim();
    if (!room) return null;
    return location === 'Main Library - Traverse City' ? room : null;
  }

  get recommendedAgeGroupsLabel(): string | null {
    const raw = (this.event?.['age_group'] ?? null) as unknown;
    if (!Array.isArray(raw)) return null;

    const labels = raw
      .map((v) => `${v ?? ''}`.trim())
      .filter((v) => !!v);

    if (!labels.length) return null;
    return labels.join(', ');
  }

  get imageUrl(): string | null {
    return (this.event?.imageUrl || this.event?.image || null) as string | null;
  }

  get externalUrl(): string | null {
    return (this.event?.registrationUrl || this.event?.url || null) as string | null;
  }

  get registrationRequired(): boolean {
    if (this.isCancelled) return false;
    return this.event?.['registration_enabled'] === true;
  }

  get isCancelled(): boolean {
    return (this.event?.['moderation_state'] ?? '').toString().trim().toLowerCase() === 'cancelled';
  }

  get registrationStartsAtDate(): Date | null {
    return this.parseRegistrationDate(this.event?.['registration_start'] ?? null);
  }

  get registrationEndsAtDate(): Date | null {
    return this.parseRegistrationDate(this.event?.['registration_end'] ?? null);
  }

  get registrationButtonVisible(): boolean {
    if (!this.registrationRequired || !this.externalUrl) return false;

    const now = new Date();
    const startsAt = this.registrationStartsAtDate;
    const endsAt = this.registrationEndsAtDate;

    if (startsAt && now.getTime() < startsAt.getTime()) return false;
    if (endsAt && now.getTime() > endsAt.getTime()) return false;
    return true;
  }

  get registrationNote(): string | null {
    if (!this.registrationRequired) return null;

    const now = new Date();
    const startsAt = this.registrationStartsAtDate;
    const endsAt = this.registrationEndsAtDate;

    if (startsAt && now.getTime() < startsAt.getTime()) {
      const startsLabel = this.formatDateOnly(startsAt);
      return `Registration is available for this event. Registration opens ${startsLabel}.`;
    }

    if (endsAt && now.getTime() > endsAt.getTime()) {
      const endsLabel = this.formatDateTime(endsAt);
      return `Registration for this event has closed as of ${endsLabel}.`;
    }

    return 'Registration is available for this event. To register please view the event page on our website.';
  }

  get registrationWindowLabel(): string | null {
    if (!this.registrationRequired) return null;

    const now = new Date();
    const startsAt = this.registrationStartsAtDate;
    const endsAt = this.registrationEndsAtDate;

    if (startsAt && now.getTime() < startsAt.getTime()) return null;
    if (endsAt && now.getTime() > endsAt.getTime()) return null;

    const startLabel = startsAt ? this.formatDateOnly(startsAt) : '';
    const endLabel = endsAt ? this.formatDateTime(endsAt) : '';

    if (startLabel && endLabel) {
      return `Registration available: ${startLabel} to ${endLabel}`;
    }
    if (endLabel) {
      return `Registration available until ${endLabel}`;
    }
    if (startLabel) {
      return `Registration available starting ${startLabel}`;
    }
    return null;
  }

  get descriptionHtml(): string {
    const raw =
      (this.event?.description ?? this.event?.summary ?? '')?.toString?.() ?? '';

    if (raw === this.descriptionHtmlCacheRaw) {
      return this.descriptionHtmlCacheValue;
    }

    this.descriptionHtmlCacheRaw = raw;
    this.descriptionHtmlCacheValue = this.buildDescriptionHtml(raw);
    return this.descriptionHtmlCacheValue;
  }

  private parseDate(value: any): Date | null {
    if (!value) return null;

    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

    const s = String(value).trim();
    if (!s) return null;
    if (s === '0' || /^0+$/.test(s)) return null;
    if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return null;
    if (s === '0000-00-00' || s.startsWith('0000-00-00 ')) return null;

    // Normalize common "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
    // Safari/iOS is picky; this avoids "Invalid Date".
    const normalized = s.includes('T') ? s : s.replace(' ', 'T');

    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  private parseRegistrationDate(value: any): Date | null {
    const raw = (value ?? '').toString().trim();
    if (!raw) return null;

    const parsed = this.parseDate(raw);
    if (!parsed) return null;

    // Feed sentinel values for "no registration date" can arrive as epoch-ish strings.
    if (raw.startsWith('1969-12-31') || raw.startsWith('1970-01-01')) return null;
    if (parsed.getTime() === 0) return null;

    return parsed;
  }

  private formatDateOnly(value: Date): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(value);
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(value);
  }

  private buildDescriptionHtml(raw: string): string {
    if (!raw) return '';

    const sanitized =
      this.sanitizer.sanitize(SecurityContext.HTML, raw)?.trim() ?? '';
    if (!sanitized) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');
    const body = doc.body;
    if (!body) return '';

    // Remove embedded CMS/media assets and any non-content blocks.
    body
      .querySelectorAll(
        'drupal-media, img, picture, video, audio, iframe, object, embed, script, style',
      )
      .forEach((node) => node.remove());

    // Keep links safe and consistent.
    body.querySelectorAll('a').forEach((link) => {
      const href = (link.getAttribute('href') ?? '').trim();
      if (!href || this.isUnsafeHref(href)) {
        link.removeAttribute('href');
      }
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      this.stripAttributes(link, ['href', 'target', 'rel']);
    });

    // Trim attributes everywhere else to avoid style/class noise.
    body.querySelectorAll('*').forEach((element) => {
      if (element.tagName.toLowerCase() !== 'a') {
        this.stripAttributes(element, []);
      }
    });

    const normalized = body.innerHTML
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return normalized;
  }

  private isUnsafeHref(href: string): boolean {
    const lower = href.toLowerCase();
    return (
      lower.startsWith('javascript:') ||
      lower.startsWith('data:') ||
      lower.startsWith('vbscript:')
    );
  }

  private stripAttributes(element: Element, allowed: string[]): void {
    const keep = new Set(allowed.map((name) => name.toLowerCase()));
    for (const attr of Array.from(element.attributes)) {
      if (!keep.has(attr.name.toLowerCase())) {
        element.removeAttribute(attr.name);
      }
    }
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.event) return;

    const id = this.eventId;
    if (!id) return;

    this.loading = true;
    this.error = null;

    try {
      const svc: any = this.eventsService as any;
      const fn =
        typeof svc.getEvent === 'function'
          ? svc.getEvent.bind(svc)
          : typeof svc.getEventById === 'function'
            ? svc.getEventById.bind(svc)
            : null;

      if (!fn) {
        throw new Error('EventsService is missing getEvent(id) / getEventById(id).');
      }

      const result = fn(id);

      if (isObservable(result)) {
        this.event = (await lastValueFrom(result)) as EventLike;
      } else if (result && typeof (result as any).then === 'function') {
        this.event = (await result) as EventLike;
      } else {
        this.event = result as EventLike;
      }

      if (!this.event) this.error = 'Event not found.';
    } catch (e: any) {
      this.error = e?.message || 'Failed to load event.';
    } finally {
      this.loading = false;
    }
  }
}
