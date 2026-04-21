import { Injectable } from '@angular/core';
import { AspenSearchHit } from './search.service';

export type FormatFamily = 'book' | 'music' | 'video' | 'other';

export interface FormatFamilyInput {
  format?: string | string[] | null;
  itemList?: any[] | Record<string, any> | null;
}

interface FormatClassification {
  family: FormatFamily;
  physical: boolean;
}

const EXACT_FORMAT_MAP: Record<string, FormatClassification> = {
  // Book-ish
  'book': { family: 'book', physical: true },
  'large print': { family: 'book', physical: true },
  'audiobook cd': { family: 'book', physical: true },
  'audiobook mp3-cd': { family: 'book', physical: true },
  'audiobook mp3 cd': { family: 'book', physical: true },
  'playaway': { family: 'book', physical: true },
  'ebook': { family: 'book', physical: false },
  'eaudiobook': { family: 'book', physical: false },
  'kindle': { family: 'book', physical: false },
  'ecomic': { family: 'book', physical: false },
  'emagazine': { family: 'book', physical: false },

  // Music-ish
  'music cd': { family: 'music', physical: true },
  'phonograph': { family: 'music', physical: true },
  'vinyl': { family: 'music', physical: true },
  'emusic': { family: 'music', physical: false },

  // Video-ish
  'dvd': { family: 'video', physical: true },
  'blu-ray': { family: 'video', physical: true },
  'bluray': { family: 'video', physical: true },
  'blu-ray / dvd combo': { family: 'video', physical: true },
  'blu-ray/dvd combo': { family: 'video', physical: true },
  'evideo': { family: 'video', physical: false },

  // Other
  'library of things': { family: 'other', physical: true },
};

const DIGITAL_HINTS = [
  'ebook',
  'eaudiobook',
  'emusic',
  'evideo',
  'kindle',
  'hoopla',
  'libby',
  'overdrive',
  'online',
  'stream',
  'download',
];

@Injectable({ providedIn: 'root' })
export class FormatFamilyService {
  iconNameForFamily(family: FormatFamily): string {
    if (family === 'book') return 'book-outline';
    if (family === 'music') return 'disc-outline';
    if (family === 'video') return 'videocam-outline';
    return 'albums-outline';
  }

  iconNameForHit(hit: AspenSearchHit): string {
    return this.iconNameForItem(hit);
  }

  iconNameForItem(item: FormatFamilyInput | null | undefined): string {
    return this.iconNameForFamily(this.primaryFamilyForItem(item));
  }

  familyLabel(family: FormatFamily): string {
    if (family === 'book') return 'Book';
    if (family === 'music') return 'Music';
    if (family === 'video') return 'Video';
    return 'Other';
  }

  uniqueFormatLabels(hit: AspenSearchHit): string[] {
    return this.uniqueFormatLabelsForItem(hit);
  }

  uniqueFormatLabelsForItem(item: FormatFamilyInput | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();

    const pushLabel = (raw: any) => {
      const label = (raw ?? '').toString().trim();
      if (!label) return;
      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(label);
    };

    if (typeof item?.format === 'string') pushLabel(item.format);
    if (Array.isArray(item?.format)) {
      for (const x of item.format) pushLabel(x);
    }
    for (const entry of this.itemListEntries(item?.itemList)) {
      pushLabel(entry?.name);
      pushLabel(entry?.format);
      pushLabel(entry?.label);
      if (!entry?.name && !entry?.format && !entry?.label) pushLabel(entry?.key);
    }

    return out;
  }

  classifyFormatLabel(label: string): FormatClassification {
    const raw = (label ?? '').toString().trim();
    const key = raw.toLowerCase();
    if (!key) return { family: 'other', physical: false };

    const exact = EXACT_FORMAT_MAP[key];
    if (exact) return exact;

    const likelyDigital = DIGITAL_HINTS.some((h) => key.includes(h));

    if (key.includes('dvd') || key.includes('blu') || key.includes('video')) {
      return { family: 'video', physical: !likelyDigital };
    }
    if (key.includes('music') || key.includes('vinyl') || key.includes('phonograph')) {
      return { family: 'music', physical: !likelyDigital };
    }
    if (
      key.includes('book') ||
      key.includes('audiobook') ||
      key.includes('comic') ||
      key.includes('magazine') ||
      key.includes('print') ||
      key.includes('playaway')
    ) {
      return { family: 'book', physical: !likelyDigital };
    }

    return { family: 'other', physical: !likelyDigital };
  }

  familiesForHit(hit: AspenSearchHit): FormatFamily[] {
    return this.familiesForItem(hit);
  }

  familiesForItem(item: FormatFamilyInput | null | undefined): FormatFamily[] {
    const families = new Set<FormatFamily>();
    for (const label of this.uniqueFormatLabelsForItem(item)) {
      families.add(this.classifyFormatLabel(label).family);
    }
    return Array.from(families.values());
  }

  primaryFamilyForHit(hit: AspenSearchHit): FormatFamily {
    return this.primaryFamilyForItem(hit);
  }

  primaryFamilyForItem(item: FormatFamilyInput | null | undefined): FormatFamily {
    const families = this.familiesForItem(item);
    if (families.includes('book')) return 'book';
    if (families.includes('music')) return 'music';
    if (families.includes('video')) return 'video';
    return 'other';
  }

  familySummaryForHit(hit: AspenSearchHit): string {
    return this.familySummaryForItem(hit);
  }

  familySummaryForItem(item: FormatFamilyInput | null | undefined): string {
    const families = this.familiesForItem(item);
    if (!families.length) return '';
    return families.map((f) => this.familyLabel(f)).join(' • ');
  }

  hasPhysicalHoldableFormat(hit: AspenSearchHit): boolean {
    return this.hasPhysicalHoldableItemFormat(hit);
  }

  hasPhysicalHoldableItemFormat(item: FormatFamilyInput | null | undefined): boolean {
    const labels = this.uniqueFormatLabelsForItem(item);
    if (!labels.length) return false;

    return labels.some((label) => {
      const cls = this.classifyFormatLabel(label);
      return cls.physical && (cls.family === 'book' || cls.family === 'music' || cls.family === 'video');
    });
  }

  private itemListEntries(itemList: FormatFamilyInput['itemList']): any[] {
    if (!itemList) return [];
    if (Array.isArray(itemList)) return itemList;
    if (typeof itemList === 'object') {
      return Object.entries(itemList).map(([key, value]) => {
        if (value && typeof value === 'object') return { key, ...value };
        return { key, name: value };
      });
    }
    return [];
  }
}
