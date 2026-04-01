import { Injectable } from '@angular/core';

import { Globals } from '../globals';

@Injectable({ providedIn: 'root' })
export class DiscoveryUrlService {
  constructor(private globals: Globals) {}

  normalize(input: unknown): string | undefined {
    let raw = (input ?? '').toString().trim();
    if (!raw) return undefined;

    raw = this.decodeEntities(raw);
    if (!raw) return undefined;

    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('/')) return `${this.globals.aspen_discovery_base}${raw}`;
    if (!/^https?:\/\//i.test(raw)) return `${this.globals.aspen_discovery_base}/${raw}`;

    try {
      const u = new URL(raw);
      const apiHost = new URL(this.globals.aspen_api_host).host;
      const discoveryHost = new URL(this.globals.aspen_discovery_base).host;
      if (u.protocol === 'http:' && (u.host === discoveryHost || u.host === apiHost)) {
        u.protocol = 'https:';
      }
      if (u.host === apiHost) {
        u.protocol = 'https:';
        u.host = discoveryHost;
      }
      return u.toString();
    } catch {
      return raw;
    }
  }

  private decodeEntities(input: string): string {
    let s = input.replace(/&nbsp;/g, ' ').trim();
    try {
      const txt = document.createElement('textarea');
      txt.innerHTML = s;
      s = txt.value;
    } catch {
      // ignore
    }
    return s.trim();
  }
}
