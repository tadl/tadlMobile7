import { Component, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

interface CopyDetailRow {
  location: string;
  callNumber: string;
  status: string;
  availability?: boolean | null;
}

interface GroupedCopyDetailRow {
  location: string;
  callNumber: string;
  status: string;
  count: number;
}

@Component({
  standalone: true,
  selector: 'app-copy-details-popover',
  templateUrl: './copy-details-popover.component.html',
  styleUrls: ['./copy-details-popover.component.scss'],
  imports: [CommonModule, IonicModule],
})
export class CopyDetailsPopoverComponent implements OnChanges, OnInit {
  @Input() formatLabel = 'Copy details';
  @Input() title = 'Untitled';
  @Input() author = '';
  @Input() coverUrl = '';
  @Input() details: CopyDetailRow[] = [];
  groupedRows: GroupedCopyDetailRow[] = [];

  constructor(private modalController: ModalController) {}

  ngOnInit(): void {
    this.groupedRows = this.groupDetails(this.details ?? []);
  }

  ngOnChanges(_changes: SimpleChanges): void {
    this.groupedRows = this.groupDetails(this.details ?? []);
  }

  close() {
    this.modalController.dismiss();
  }

  private groupDetails(details: CopyDetailRow[]): GroupedCopyDetailRow[] {
    const groups = new Map<string, { location: string; callNumber: string; statuses: string[]; count: number; availableCount: number }>();

    for (const d of details) {
      const location = (d?.location ?? '').toString().trim();
      const callNumber = (d?.callNumber ?? '').toString().trim();
      const status = (d?.status ?? '').toString().trim();
      const available = d?.availability === true;
      const key = `${location}||${callNumber}`;

      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        if (status) existing.statuses.push(status);
        if (available) existing.availableCount += 1;
        continue;
      }

      groups.set(key, {
        location,
        callNumber,
        statuses: status ? [status] : [],
        count: 1,
        availableCount: available ? 1 : 0,
      });
    }

    const rows: GroupedCopyDetailRow[] = [];
    for (const g of groups.values()) {
      const status = this.summarizeStatus(g.statuses, g.availableCount);
      rows.push({
        location: g.location,
        callNumber: g.callNumber,
        status,
        count: g.count,
      });
    }

    return rows;
  }

  trackByGroupedRow(_idx: number, row: GroupedCopyDetailRow): string {
    return `${row.location}||${row.callNumber}||${row.status}||${row.count}`;
  }

  copyCountText(n: number): string {
    const count = Number(n);
    if (!Number.isFinite(count) || count <= 0) return '';
    return `${count} ${count === 1 ? 'copy' : 'copies'}`;
  }

  private summarizeStatus(statuses: string[], availableCount: number): string {
    if (availableCount > 0) {
      return `${availableCount} Available`;
    }

    const clean = (statuses ?? [])
      .map((s) => (s ?? '').toString().trim())
      .filter(Boolean);
    if (!clean.length) return '';

    const first = clean[0];
    if (clean.every((s) => s === first)) return first;
    return 'Mixed status';
  }
}
