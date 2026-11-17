import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';

import { APP_TEST_PROVIDERS } from '../../../testing/app-test-providers';
import { Globals } from '../../globals';
import { AuthService } from '../../services/auth.service';
import { CheckoutsService } from '../../services/checkouts.service';
import { HoldsService } from '../../services/holds.service';
import { HoldSupportService } from '../../services/hold-support.service';
import {
  ItemService,
  type AspenEditionRecord,
  type AspenFormatRecordsResult,
  type AspenFormatVariationsResult,
  type AspenGroupedWork,
} from '../../services/item.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { ListsService } from '../../services/lists.service';
import { ToastService } from '../../services/toast.service';
import { ItemDetailComponent } from './item-detail.component';

describe('ItemDetailComponent edition details', () => {
  let fixture: ComponentFixture<ItemDetailComponent>;
  let component: ItemDetailComponent;
  let items: jasmine.SpyObj<ItemService>;
  let workUpdates: Subject<AspenGroupedWork>;
  let variations: Map<string, Subject<AspenFormatVariationsResult>>;
  let records: Map<string, Subject<AspenFormatRecordsResult>>;

  const workId = 'synthetic-work-eng';
  const anonymous = {
    isLoggedIn: false,
    activeAccountId: null,
    activeAccountMeta: null,
    profile: null,
  };

  beforeEach(async () => {
    workUpdates = new Subject();
    variations = new Map();
    records = new Map();
    items = jasmine.createSpyObj<ItemService>('ItemService', [
      'getGroupedWork',
      'getFormatVariations',
      'getFormatRecords',
      'extractIlsIdFromOnclick',
    ]);
    items.getGroupedWork.and.returnValue(workUpdates);
    items.extractIlsIdFromOnclick.and.returnValue(null);
    items.getFormatVariations.and.callFake((id, format) => {
      const updates = new Subject<AspenFormatVariationsResult>();
      variations.set(`${id}|${format}`, updates);
      return updates;
    });
    items.getFormatRecords.and.callFake((id, format, source) => {
      const updates = new Subject<AspenFormatRecordsResult>();
      records.set(`${id}|${format}|${source}`, updates);
      return updates;
    });

    await TestBed.configureTestingModule({
      imports: [ItemDetailComponent],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: Globals, useValue: {
          aspen_discovery_base: 'https://catalog.example.org',
          aspen_api_host: 'https://api.example.org',
        } },
        { provide: ItemService, useValue: items },
        { provide: AuthService, useValue: {
          snapshot: () => anonymous,
          authState: () => of(anonymous),
        } },
        { provide: HoldsService, useValue: { fetchActiveHolds: () => of([]) } },
        { provide: CheckoutsService, useValue: { fetchActiveCheckouts: () => of([]) } },
        { provide: ListsService, useValue: {} },
        { provide: ListLookupService, useValue: {
          lookup: async () => ({ lists: [], lastListUsed: null }),
          membershipsForRecord: async () => [],
        } },
        { provide: HoldSupportService, useValue: {} },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['presentToast']) },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ItemDetailComponent);
    component = fixture.componentInstance;
    component.hit = { key: workId, title: 'Synthetic title', itemList: [], raw: {} };
    render();
  });

  it('keeps multiple editions inside their matching format rows', () => {
    workUpdates.next(work(['Book', 'Large Print']));
    emitVariations(workId, 'Book', ['ils']);
    emitVariations(workId, 'Large Print', ['ils']);
    emitRecords(workId, 'Book', 'ils', [
      record('901001', 'Book', { publisher: 'Example Press', publicationDate: '2020', physical: '388 pages ; 23 cm.' }),
      record('901002', 'Book', { publisher: 'Synthetic Books', publicationDate: '2024', physical: '402 pages ; 25 cm.' }),
    ]);
    emitRecords(workId, 'Large Print', 'ils', [
      record('901003', 'Large Print', { edition: 'Large print edition.', physical: '648 pages ; 26 cm.' }),
    ]);
    render();

    const book = formatRow('Book');
    const largePrint = formatRow('Large Print');
    expect(book.querySelectorAll('.edition-record').length).toBe(2);
    expect(book.textContent).toContain('Example Press · 2020');
    expect(book.textContent).toContain('Synthetic Books · 2024');
    expect(book.textContent).toContain('388 pages ; 23 cm.');
    expect(book.textContent).not.toContain('648 pages');
    expect(largePrint.textContent).toContain('Large print edition.');
    expect(largePrint.textContent).toContain('648 pages ; 26 cm.');
    expect(largePrint.textContent).not.toContain('388 pages');
    expect(book.textContent).not.toContain('901001');
    expect(fixture.nativeElement.querySelector('.edition-details-card')).toBeNull();
  });

  it('updates cached records without duplicating requests or identical metadata', () => {
    const currentWork = work(['Book']);
    workUpdates.next(currentWork);
    emitVariations(workId, 'Book', ['ils', 'ils']);
    emitRecords(workId, 'Book', 'ils', [
      record('901001', 'Book', { physical: '388 pages ; 23 cm.' }),
    ]);
    workUpdates.next(currentWork);
    emitVariations(workId, 'Book', ['ils']);
    emitRecords(workId, 'Book', 'ils', [
      record('901001', 'Book', { physical: '390 pages ; 23 cm.' }),
      record('901002', 'Book', { physical: '390 pages ; 23 cm.' }),
    ]);
    render();

    expect(items.getFormatVariations).toHaveBeenCalledTimes(1);
    expect(items.getFormatRecords).toHaveBeenCalledTimes(1);
    expect(formatRow('Book').querySelectorAll('.edition-record').length).toBe(1);
    expect(formatRow('Book').textContent).not.toContain('388 pages');
  });

  it('keeps audiobook duration and disc details intact', () => {
    workUpdates.next(work(['Audio CD', 'eAudiobook']));
    emitVariations(workId, 'Audio CD', ['ils']);
    emitVariations(workId, 'eAudiobook', ['hoopla']);
    emitRecords(workId, 'Audio CD', 'ils', [
      record('901004', 'Audio CD', { physical: '12 audio discs (15 hr.) : digital ; 4 3/4 in.' }),
    ]);
    emitRecords(workId, 'eAudiobook', 'hoopla', [
      record('901005', 'eAudiobook', { id: 'hoopla:901005', source: 'hoopla', physical: '14h 57m 1s' }),
    ]);
    render();

    expect(formatRow('Audio CD').textContent).toContain('Physical description');
    expect(formatRow('Audio CD').textContent).toContain('12 audio discs (15 hr.) : digital ; 4 3/4 in.');
    expect(formatRow('eAudiobook').textContent).toContain('Duration');
    expect(formatRow('eAudiobook').textContent).toContain('14h 57m 1s');
  });

  it('combines repeated digital edition metadata while retaining provider and year for each runtime', () => {
    workUpdates.next(work(['eAudiobook']));
    emitVariations(workId, 'eAudiobook', ['hoopla', 'overdrive']);
    const metadata = { edition: 'Unabridged', publisher: 'Example Audio' };
    emitRecords(workId, 'eAudiobook', 'hoopla', [
      record('901005', 'eAudiobook', { ...metadata, id: 'hoopla:901005', source: 'hoopla', publicationDate: '2024', physical: '12h 3m' }),
      record('901006', 'eAudiobook', { ...metadata, id: 'hoopla:901006', source: 'hoopla', publicationDate: '2015', physical: '11h 49m' }),
    ]);
    emitRecords(workId, 'eAudiobook', 'overdrive', [
      record('901007', 'eAudiobook', { ...metadata, id: 'overdrive:901007', source: 'overdrive', publicationDate: '2015' }),
    ]);
    render();

    const row = formatRow('eAudiobook');
    expect(row.querySelectorAll('.edition-record').length).toBe(1);
    expect(row.textContent?.match(/Unabridged/g)?.length).toBe(1);
    expect(row.textContent?.match(/Example Audio/g)?.length).toBe(1);
    expect(row.textContent).toContain('2024, 2015');
    const durations = row.querySelectorAll('.edition-physical-value');
    expect(durations.length).toBe(2);
    expect(durations[0].textContent).toContain('12h 3m');
    expect(durations[0].textContent).toContain('Hoopla · 2024');
    expect(durations[1].textContent).toContain('11h 49m');
    expect(durations[1].textContent).toContain('Hoopla · 2015');
    expect(durations[0].textContent).not.toContain('Libby');
    expect(durations[1].textContent).not.toContain('Libby');
  });

  it('removes cached sources absent from refreshed variations and ignores their later records', () => {
    workUpdates.next(work(['eBook']));
    emitVariations(workId, 'eBook', ['hoopla', 'overdrive']);
    const removed = records.get(`${workId}|eBook|hoopla`)!;
    emitRecords(workId, 'eBook', 'hoopla', [
      record('901005', 'eBook', { id: 'hoopla:901005', source: 'hoopla', physical: 'Removed provider details' }),
    ]);
    emitRecords(workId, 'eBook', 'overdrive', [
      record('901006', 'eBook', { id: 'overdrive:901006', source: 'overdrive', physical: 'Current provider details' }),
    ]);
    emitVariations(workId, 'eBook', ['overdrive']);
    removed.next({ success: true, id: workId, format: 'eBook', source: 'hoopla', records: [
      record('901005', 'eBook', { id: 'hoopla:901005', source: 'hoopla', physical: 'Removed late details' }),
    ] });
    render();

    expect(removed.observed).toBeFalse();
    expect(formatRow('eBook').textContent).toContain('Current provider details');
    expect(formatRow('eBook').textContent).not.toContain('Removed');
  });

  it('handles sources independently and omits empty detail blocks', () => {
    workUpdates.next(work(['eBook', 'Book']));
    emitVariations(workId, 'eBook', ['overdrive', 'hoopla']);
    emitVariations(workId, 'Book', ['ils']);
    records.get(`${workId}|eBook|overdrive`)!.error(new Error('Synthetic API failure'));
    emitRecords(workId, 'eBook', 'hoopla', [
      record('901006', 'eBook', { id: 'hoopla:901006', source: 'hoopla', physical: '1 online resource' }),
    ]);
    emitRecords(workId, 'Book', 'ils', [record('901001', 'Book')]);
    render();

    expect(formatRow('eBook').textContent).toContain('1 online resource');
    expect(formatRow('eBook').querySelectorAll('.edition-record').length).toBe(1);
    expect(formatRow('Book').querySelector('.edition-details')).toBeNull();
    expect(component.providerStatusesForFormat('Book')).toEqual([]);
    expect(component.providerStatusesForFormat('eBook').length).toBe(2);
  });

  it('cancels old-work metadata and ignores stale response identities', () => {
    workUpdates.next(work(['Book']));
    emitVariations(workId, 'Book', ['ils']);
    const oldRecords = records.get(`${workId}|Book|ils`)!;
    const nextId = 'synthetic-next-work-eng';
    workUpdates.next(work(['Book'], nextId));
    emitVariations(nextId, 'Book', ['ils']);
    oldRecords.next({ success: true, id: workId, format: 'Book', source: 'ils', records: [
      record('901001', 'Book', { physical: 'Old work description' }),
    ] });
    records.get(`${nextId}|Book|ils`)!.next({
      success: true, id: workId, format: 'Book', source: 'ils', records: [
        record('901002', 'Book', { physical: 'Wrong response identity' }),
      ],
    });
    render();

    expect(oldRecords.observed).toBeFalse();
    expect(component.editionDetailsByFormat).toEqual({});
    emitRecords(nextId, 'Book', 'ils', [
      record('901003', 'Book', { physical: 'New work description' }),
    ]);
    render();
    expect(formatRow('Book').textContent).toContain('New work description');
    expect(formatRow('Book').textContent).not.toContain('Old work description');

    fixture.destroy();
    expect(workUpdates.observed).toBeFalse();
    expect(records.get(`${nextId}|Book|ils`)!.observed).toBeFalse();
  });

  function work(formats: string[], id = workId): AspenGroupedWork {
    return {
      id, title: 'Synthetic title',
      formats: Object.fromEntries(formats.map((format) => [format, {
        label: format,
        category: format.startsWith('e') ? 'eContent' : 'Books',
        actions: [],
        isAvailable: true,
      }])),
    };
  }

  function emitVariations(id: string, format: string, sources: string[]) {
    variations.get(`${id}|${format}`)!.next({
      success: true, id, format,
      variations: Object.fromEntries(sources.map((source, index) => [
        `${source === 'hoopla' ? 'Hoopla' : source === 'overdrive' ? 'Libby' : source}${index ? ` ${index}` : ''}`,
        { source, id: `${source}:901001`, actions: [] },
      ])),
    });
  }

  function emitRecords(id: string, format: string, source: string, editions: AspenEditionRecord[]) {
    records.get(`${id}|${format}|${source}`)!.next({ success: true, id, format, source, records: editions });
  }

  function record(id: string, format: string, metadata: Partial<AspenEditionRecord> = {}): AspenEditionRecord {
    return {
      id: `ils:${id}`, source: 'ils', recordId: id, format,
      edition: '', publisher: '', publicationDate: '', placeOfPublication: '', physical: '',
      ...metadata,
    };
  }

  function render() {
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
  }

  function formatRow(label: string): HTMLElement {
    const rows: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.format-row'));
    return rows.find((row) => row.querySelector('.format-title')?.textContent?.trim() === label)!;
  }
});
