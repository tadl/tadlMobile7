// src/app/services/item.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, concat, from, filter, tap } from 'rxjs';
import { Globals } from '../globals';
import { AppCacheService } from './app-cache.service';
import { DiscoveryUrlService } from './discovery-url.service';

export type AspenWorkAction =
  | {
      title: string;
      url?: string;
      target?: string;
      requireLogin?: boolean;
      type?: string;
      onclick?: string;
      id?: string;
      btnType?: string;
      formatId?: number;
      sampleNumber?: number;
    }
  | any;

export interface AspenWorkFormat {
  label: string;
  category: string;
  actions: AspenWorkAction[];
  isAvailable: boolean;
  numRelatedRecords?: number;
}

export interface AspenGroupedWork {
  success?: boolean; // Aspen sometimes includes success at this level
  id: string;
  title: string;
  subtitle?: string;
  author?: string;
  description?: string;
  language?: string;
  cover?: string;

  series?: { seriesTitle: string; volume?: string }[] | null;

  // Key part:
  formats?: Record<string, AspenWorkFormat>;
}

export interface AspenHoldingItem {
  location?: string;
  callnumber?: string;
  status?: string;
  dueDate?: string;
  availability?: boolean;
  holdable?: number;

  statusFull?: string;
  statusfull?: string;

  // e.g. "ils:48283600"
  id?: string;
  number?: number;
  libraryDisplayName?: string;
  section?: string;
  sectionId?: number;
  lastCheckinDate?: string;
}

export interface AspenItemAvailabilityResult {
  id: string;
  holdings: Record<string, AspenHoldingItem[]>;
}

export interface AspenVariationStatusIndicator {
  isAvailable?: boolean;
  isEContent?: boolean;
  isAvailableOnline?: boolean;
  groupedStatus?: string;
  numCopiesMessage?: string;
  numHolds?: number;
}

export interface AspenFormatVariation {
  id?: string;
  source?: string;
  actions?: AspenWorkAction[];
  statusIndicator?: AspenVariationStatusIndicator;
}

export interface AspenFormatVariationsResult {
  success: boolean;
  id?: string;
  format?: string;
  variations: Record<string, AspenFormatVariation>;
  message?: string;
}

export interface AspenEditionRecord {
  id: string;
  source: string;
  recordId: string;
  format: string;
  edition: string;
  publisher: string;
  publicationDate: string;
  placeOfPublication: string;
  physical: string;
}

export interface AspenFormatRecordsResult {
  success: boolean;
  id: string;
  format: string;
  source: string;
  records: AspenEditionRecord[];
}

@Injectable({ providedIn: 'root' })
export class ItemService {
  private http = inject(HttpClient);
  private globals = inject(Globals);
  private cache = inject(AppCacheService);
  private discoveryUrls = inject(DiscoveryUrlService);

  /**
   * Work-level details (grouped work):
   * GET /API/WorkAPI?method=getGroupedWork&id=<groupedWorkKey>&api=tadl-prod
   */
  getGroupedWork(groupedWorkKey: string): Observable<AspenGroupedWork> {
    const key = (groupedWorkKey || '').trim();
    const params = new HttpParams()
      .set('method', 'getGroupedWork')
      .set('id', key);

    const cacheKey = `item:groupedWork:${key}`;
    const cached$ = from(this.cache.read<AspenGroupedWork>(cacheKey)).pipe(
      filter((v): v is AspenGroupedWork => !!v && typeof v === 'object')
    );

    const network$ = this.http
      .get<any>(`${this.globals.aspen_api_base}/WorkAPI`, { params })
      .pipe(
        map((raw) => this.normalizeGroupedWork(raw?.result ?? raw)),
        tap((work) => {
          this.cache.write(cacheKey, work).catch(() => {});
        })
      );

    return concat(cached$, network$);
  }

  /**
   * Holdings / availability (ILS only):
   * GET /API/ItemAPI?method=getItemAvailability&id=<ilsNumericId>&api=tadl-prod
   *
   * IMPORTANT:
   * - Passing "ils:48283600" does NOT work; Aspen expects bare numeric id.
   * - This does not apply to hoopla/overdrive ids.
   */
  getIlsItemAvailability(id: string): Observable<AspenItemAvailabilityResult> {
    const numeric = this.stripIlsPrefix(id);

    const params = new HttpParams()
      .set('method', 'getItemAvailability')
      .set('id', numeric);

    const cacheKey = `item:availability:${numeric}`;
    const cached$ = from(
      this.cache.read<AspenItemAvailabilityResult>(cacheKey)
    ).pipe(
      filter(
        (v): v is AspenItemAvailabilityResult => !!v && typeof v === 'object'
      )
    );

    const network$ = this.http
      .get<any>(`${this.globals.aspen_api_base}/ItemAPI`, { params })
      .pipe(
        map((raw) => (raw?.result ?? raw) as AspenItemAvailabilityResult),
        tap((availability) => {
          this.cache.write(cacheKey, availability).catch(() => {});
        })
      );

    return concat(cached$, network$);
  }

  /**
   * Format-level variation/status info (includes eContent provider details like OverDrive/Hoopla).
   * GET /API/ItemAPI?method=getVariations&id=<groupedWorkKey>&format=<formatLabel>
   */
  getFormatVariations(
    groupedWorkKey: string,
    formatLabel: string
  ): Observable<AspenFormatVariationsResult> {
    const key = (groupedWorkKey || '').trim();
    const format = (formatLabel || '').trim();

    const params = new HttpParams()
      .set('method', 'getVariations')
      .set('id', key)
      .set('format', format);

    const cacheKey = `item:variations:${key}:${format.toLowerCase()}`;
    const cached$ = from(
      this.cache.read<AspenFormatVariationsResult>(cacheKey)
    ).pipe(
      filter(
        (v): v is AspenFormatVariationsResult =>
          !!v && typeof v === 'object' && !!v.variations
      )
    );

    const network$ = this.http
      .get<any>(`${this.globals.aspen_api_base}/ItemAPI`, { params })
      .pipe(
        map((raw) =>
          this.normalizeVariationsResult(raw?.result ?? raw, key, format)
        ),
        tap((result) => {
          this.cache.write(cacheKey, result).catch(() => {});
        })
      );

    return concat(cached$, network$);
  }

  /** Bibliographic editions within one grouped work, format, and source. */
  getFormatRecords(
    groupedWorkKey: string,
    formatKey: string,
    recordSource: string
  ): Observable<AspenFormatRecordsResult> {
    const key = groupedWorkKey.trim();
    const format = formatKey.trim();
    const source = recordSource.trim();
    const params = new HttpParams()
      .set('method', 'getRecords')
      .set('id', key)
      .set('format', format)
      .set('source', source);

    const cacheKey = `item:records:${key}:${format}:${source}`;
    const cached$ = from(
      this.cache.read<AspenFormatRecordsResult>(cacheKey)
    ).pipe(
      filter(
        (value): value is AspenFormatRecordsResult =>
          value?.success === true &&
          value.id === key &&
          value.format === format &&
          value.source === source &&
          Array.isArray(value.records)
      )
    );
    const network$ = this.http
      .get<unknown>(`${this.globals.aspen_api_base}/ItemAPI`, { params })
      .pipe(
        map((raw) => this.normalizeFormatRecords(raw, key, format, source)),
        tap((result) => {
          if (result.success) this.cache.write(cacheKey, result).catch(() => {});
        })
      );

    return concat(cached$, network$);
  }

  stripIlsPrefix(id: string): string {
    const s = (id || '').trim();
    if (s.startsWith('ils:')) return s.slice(4);
    return s;
  }

  /**
   * Extract ILS record id from Aspen "Place Hold" onclick strings.
   * Example:
   * return AspenDiscovery.Record.showPlaceHold('Record', 'ils', '48283600', '', '243863');
   * return AspenDiscovery.Record.showPlaceHoldEditions('Record', 'ils', '48021521', '', '9549');
   */
  extractIlsIdFromOnclick(onclick?: string): string | null {
    if (!onclick) return null;

    const m = onclick.match(
      /showPlaceHold(?:Editions)?\s*\([^)]*['"]ils['"]\s*,\s*['"]([^'"]+)['"]/i
    );
    const id = (m?.[1] ?? '').toString().trim();
    if (id) return id;

    return null;
  }

  /**
   * Returns unique numeric ILS ids found within WorkAPI formats/actions.
   */
  extractIlsIdsFromGroupedWork(work?: AspenGroupedWork): string[] {
    const formats = work?.formats ?? {};
    const ids = new Set<string>();

    for (const fmt of Object.values(formats)) {
      for (const action of fmt.actions ?? []) {
        const onclick = (action as any)?.onclick as string | undefined;
        const id = this.extractIlsIdFromOnclick(onclick);
        if (id) ids.add(id);
      }
    }

    return Array.from(ids);
  }

  private normalizeVariationsResult(
    input: any,
    groupedWorkKey: string,
    formatLabel: string
  ): AspenFormatVariationsResult {
    const sourceVariations = input?.variations;
    const entries =
      sourceVariations && typeof sourceVariations === 'object'
        ? Object.entries(sourceVariations)
        : [];

    const variations: Record<string, AspenFormatVariation> = {};
    for (const [label, rawVariation] of entries as Array<[string, any]>) {
      variations[label] = {
        id: typeof rawVariation?.id === 'string' ? rawVariation.id : undefined,
        source:
          typeof rawVariation?.source === 'string'
            ? rawVariation.source
            : undefined,
        actions: Array.isArray(rawVariation?.actions)
          ? rawVariation.actions
          : [],
        statusIndicator:
          rawVariation?.statusIndicator &&
          typeof rawVariation.statusIndicator === 'object'
            ? {
                isAvailable: !!rawVariation.statusIndicator?.isAvailable,
                isEContent: !!rawVariation.statusIndicator?.isEContent,
                isAvailableOnline:
                  !!rawVariation.statusIndicator?.isAvailableOnline,
                groupedStatus:
                  typeof rawVariation.statusIndicator?.groupedStatus ===
                  'string'
                    ? rawVariation.statusIndicator.groupedStatus
                    : undefined,
                numCopiesMessage:
                  typeof rawVariation.statusIndicator?.numCopiesMessage ===
                  'string'
                    ? rawVariation.statusIndicator.numCopiesMessage
                    : undefined,
                numHolds: Number.isFinite(
                  Number(rawVariation.statusIndicator?.numHolds)
                )
                  ? Number(rawVariation.statusIndicator.numHolds)
                  : undefined,
              }
            : undefined,
      };
    }

    return {
      success: !!input?.success,
      id: typeof input?.id === 'string' ? input.id : groupedWorkKey,
      format: typeof input?.format === 'string' ? input.format : formatLabel,
      variations,
      message: typeof input?.message === 'string' ? input.message : undefined,
    };
  }

  private normalizeFormatRecords(
    raw: unknown,
    id: string,
    format: string,
    source: string
  ): AspenFormatRecordsResult {
    const envelope = this.recordObject(raw);
    const input = this.recordObject(envelope['result'] ?? raw);
    const success =
      input['success'] === true &&
      input['id'] === id &&
      input['format'] === format;
    const records: AspenEditionRecord[] = [];
    const rawRecords = this.recordObject(input['records']);

    if (success) {
      for (const [recordKey, value] of Object.entries(rawRecords)) {
        const record = this.recordObject(value);
        const recordId = this.metadataText(record['id']) || recordKey;
        if (
          record['source'] !== source ||
          record['format'] !== format ||
          !recordId.startsWith(`${source}:`) ||
          recordId.length <= source.length + 1
        ) continue;

        records.push({
          id: recordId,
          source,
          recordId: recordId.slice(source.length + 1),
          format,
          edition: this.metadataText(record['edition']),
          publisher: this.metadataText(record['publisher']),
          publicationDate: this.metadataText(record['publicationDate']),
          placeOfPublication: this.metadataText(record['placeOfPublication']),
          physical: this.metadataText(record['physical']),
        });
      }
    }

    return { success, id, format, source, records };
  }

  private recordObject(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private metadataText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      return value
        .filter((part): part is string => typeof part === 'string')
        .map((part) => part.trim())
        .filter(Boolean)
        .join('; ');
    }
    return '';
  }

  private normalizeGroupedWork(input: any): AspenGroupedWork {
    const work = (input ?? {}) as AspenGroupedWork;
    return {
      ...work,
      cover: this.discoveryUrls.normalize(work?.cover),
    };
  }
}
