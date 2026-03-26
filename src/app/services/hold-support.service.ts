import { Injectable } from '@angular/core';
import { lastValueFrom } from 'rxjs';

import { AuthService } from './auth.service';
import { HoldsService } from './holds.service';
import { ItemService } from './item.service';
import { AccountPreferencesService } from './account-preferences.service';
import { FormatFamilyService } from './format-family.service';
import { Globals } from '../globals';

export interface HoldTargetOption {
  recordId: string;
  label: string;
  formatLabel: string;
  isOnHold?: boolean;
}

export interface HoldableEntryContext {
  groupedKey: string;
  itemList?: any[];
  rawItemList?: any;
  title?: string;
  author?: string;
  coverUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class HoldSupportService {
  constructor(
    private auth: AuthService,
    private holds: HoldsService,
    private items: ItemService,
    private accountPreferences: AccountPreferencesService,
    private formatFamily: FormatFamilyService,
    private globals: Globals,
  ) {}

  async hasCachedHoldForGroupedKey(groupedKey: string): Promise<boolean> {
    const normalized = this.normalizeGroupedKey(groupedKey);
    if (!normalized) return false;

    const holds = await this.cachedHoldsForLookup();
    return (holds ?? []).some((hold) => this.normalizeGroupedKey(hold?.groupedWorkId) === normalized);
  }

  async holdTargetsWithStatus(entry: HoldableEntryContext): Promise<HoldTargetOption[]> {
    const groupedKey = this.normalizeGroupedKey(entry.groupedKey);
    if (!groupedKey) return [];

    const holdTargets = await this.resolveIlsHoldTargets(entry);
    if (!holdTargets.length) return [];
    if (!this.auth.snapshot()?.isLoggedIn) return holdTargets;

    const [heldRecordIds, heldFormatKeys] = await Promise.all([
      this.heldRecordIdsForGroupedKey(groupedKey),
      this.heldFormatKeysForGroupedKey(groupedKey),
    ]);

    return holdTargets.map((target) => ({
      ...target,
      isOnHold:
        heldRecordIds.has(target.recordId) ||
        heldFormatKeys.has(this.normalizeFormatKey(target.formatLabel)),
    }));
  }

  async defaultPickupBranchCode(): Promise<string | null> {
    const activeId = (this.auth.snapshot()?.activeAccountId ?? '').toString().trim();
    if (!activeId) return null;

    try {
      const prefs = await this.accountPreferences.getCachedPreferences(activeId);
      const legacyCode = (prefs?.pickup_library ?? '').toString().trim();
      if (!legacyCode) return null;
      const loc = this.globals.pickupLocationFromLegacyPreferencesCode(legacyCode);
      return loc?.code ?? null;
    } catch {
      return null;
    }
  }

  async cacheOptimisticPlacedHold(
    entry: HoldableEntryContext,
    recordId: string,
    selectedFormatLabel?: string,
  ): Promise<void> {
    const groupedKey = this.normalizeGroupedKey(entry.groupedKey);
    if (!groupedKey) return;

    await this.holds.upsertCachedHold({
      source: 'ils',
      type: 'ils',
      groupedWorkId: groupedKey,
      recordId: Number(recordId),
      format: selectedFormatLabel ? [selectedFormatLabel] : undefined,
      title: entry.title,
      author: entry.author,
      coverUrl: entry.coverUrl,
    } as any);
  }

  private async resolveIlsHoldTargets(entry: HoldableEntryContext): Promise<HoldTargetOption[]> {
    const groupedKey = this.normalizeGroupedKey(entry.groupedKey);
    if (!groupedKey) return [];

    const fromPayload = this.resolveIlsHoldTargetsFromItemList(entry);
    if (fromPayload.length) return fromPayload;

    try {
      const work = await lastValueFrom(this.items.getGroupedWork(groupedKey));
      const physicalById = new Map<string, HoldTargetOption>();
      const anyById = new Map<string, HoldTargetOption>();

      for (const [formatKey, fmt] of Object.entries(work?.formats ?? {})) {
        const formatLabel =
          (fmt?.label ?? '').toString().trim() ||
          (formatKey ?? '').toString().trim() ||
          'Format';
        const cls = this.formatFamily.classifyFormatLabel(formatLabel);

        for (const action of fmt?.actions ?? []) {
          const id = this.items.extractIlsIdFromOnclick((action as any)?.onclick);
          if (!id) continue;

          const actionTitle = ((action as any)?.title ?? '').toString().trim();
          const isPlainPlaceHold = actionTitle.toLowerCase() === 'place hold';
          const label = actionTitle && !isPlainPlaceHold ? `${formatLabel} (${actionTitle})` : formatLabel;
          const target: HoldTargetOption = { recordId: id, label, formatLabel };

          if (!anyById.has(id)) anyById.set(id, target);
          if ((cls.physical || isPlainPlaceHold) && !physicalById.has(id)) physicalById.set(id, target);
        }
      }

      const physical = Array.from(physicalById.values());
      if (physical.length) return physical;
      return Array.from(anyById.values());
    } catch {
      return [];
    }
  }

  private resolveIlsHoldTargetsFromItemList(entry: HoldableEntryContext): HoldTargetOption[] {
    const physicalById = new Map<string, HoldTargetOption>();
    const anyById = new Map<string, HoldTargetOption>();

    const sourceItems = this.rawItemListEntries(entry);
    for (const item of sourceItems) {
      const source = (item?.source ?? item?.type ?? '').toString().trim().toLowerCase();
      if (source && source !== 'ils') continue;

      const recordId = this.extractIlsRecordIdFromItemLike(item);
      if (!recordId) continue;

      const formatLabel = (
        item?.name ??
        item?.label ??
        item?.format ??
        item?.title ??
        ''
      ).toString().trim() || 'Format';
      const cls = this.formatFamily.classifyFormatLabel(formatLabel);
      const target: HoldTargetOption = { recordId, label: formatLabel, formatLabel };

      if (!anyById.has(recordId)) anyById.set(recordId, target);
      if (cls.physical && !physicalById.has(recordId)) physicalById.set(recordId, target);
    }

    const physical = Array.from(physicalById.values());
    if (physical.length) return physical;
    return Array.from(anyById.values());
  }

  private rawItemListEntries(entry: HoldableEntryContext): any[] {
    const rawValues = Array.isArray(entry.rawItemList)
      ? entry.rawItemList
      : entry.rawItemList && typeof entry.rawItemList === 'object'
        ? Object.values(entry.rawItemList)
        : [];
    const normalized = Array.isArray(entry.itemList) ? entry.itemList : [];
    return [...rawValues, ...normalized];
  }

  private extractIlsRecordIdFromItemLike(item: any): string {
    const directId = this.extractIlsRecordIdFromValue(item?.id ?? item?.recordId ?? item?.itemId);
    if (directId) return directId;

    const onclickId = this.items.extractIlsIdFromOnclick((item?.onclick ?? '').toString());
    if (onclickId) return onclickId;

    return '';
  }

  private extractIlsRecordIdFromValue(raw: any): string {
    const value = (raw ?? '').toString().trim();
    if (!value) return '';

    const stripped = this.items.stripIlsPrefix(value);
    if (/^\d+$/.test(stripped)) return stripped;

    const prefixedMatch = value.match(/(?:^|:)ils:(\d+)(?:$|:)/i);
    if (prefixedMatch?.[1]) return prefixedMatch[1];

    const digitsMatch = value.match(/\b(\d{5,})\b/);
    if (digitsMatch?.[1]) return digitsMatch[1];

    return '';
  }

  private async heldRecordIdsForGroupedKey(groupedKey: string): Promise<Set<string>> {
    const normalized = this.normalizeGroupedKey(groupedKey);
    if (!normalized) return new Set<string>();

    const holds = await this.cachedHoldsForLookup();
    const ids = new Set<string>();
    for (const hold of holds ?? []) {
      if (this.normalizeGroupedKey(hold?.groupedWorkId) !== normalized) continue;
      const rid = (hold?.recordId ?? '').toString().trim();
      if (rid) ids.add(rid);
    }
    return ids;
  }

  private async heldFormatKeysForGroupedKey(groupedKey: string): Promise<Set<string>> {
    const normalized = this.normalizeGroupedKey(groupedKey);
    if (!normalized) return new Set<string>();

    const holds = await this.cachedHoldsForLookup();
    const keys = new Set<string>();
    for (const hold of holds ?? []) {
      if (this.normalizeGroupedKey(hold?.groupedWorkId) !== normalized) continue;

      const f = (hold as any)?.format;
      if (Array.isArray(f)) {
        for (const x of f) {
          const key = this.normalizeFormatKey((x ?? '').toString());
          if (key) keys.add(key);
        }
      } else if (typeof f === 'string') {
        const key = this.normalizeFormatKey(f);
        if (key) keys.add(key);
      }
    }
    return keys;
  }

  private async cachedHoldsForLookup(): Promise<any[]> {
    const snap = this.auth.snapshot();
    const activeId = (snap?.activeAccountId ?? '').toString().trim();
    if (!activeId) return [];

    try {
      const cached = await this.holds.getCachedHolds(activeId);
      return Array.isArray(cached?.holds) ? cached.holds : [];
    } catch {
      return [];
    }
  }

  private normalizeGroupedKey(value: any): string {
    return (value ?? '').toString().trim().toLowerCase();
  }

  private normalizeFormatKey(value: string): string {
    return (value ?? '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }
}
