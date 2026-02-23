import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, ModalController, ActionSheetController } from '@ionic/angular';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ListsService, type AspenListTitle } from '../../services/lists.service';
import { ItemDetailComponent } from '../../components/item-detail/item-detail.component';
import { AspenSearchHit } from '../../services/search.service';

@Component({
  standalone: true,
  selector: 'app-my-list-detail',
  templateUrl: './my-list-detail.page.html',
  styleUrls: ['./my-list-detail.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class MyListDetailPage {
  loading = false;
  listId = '';
  listTitle = 'List';
  listDescription = '';
  titles: AspenListTitle[] = [];
  removingRecordId = '';

  constructor(
    public globals: Globals,
    private route: ActivatedRoute,
    private listsService: ListsService,
    private toast: ToastService,
    private modalController: ModalController,
    private actionSheetCtrl: ActionSheetController,
  ) {}

  ionViewWillEnter() {
    this.listId = (this.route.snapshot.paramMap.get('id') ?? '').trim();
    const hint = (this.route.snapshot.queryParamMap.get('title') ?? '').trim();
    if (hint) this.listTitle = hint;
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }
    if (!this.listId) {
      this.toast.presentToast('Invalid list id.');
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.listsService.fetchListTitles(this.listId, 1, 100).pipe(
      finalize(() => {
        this.loading = false;
        ev?.target?.complete?.();
      }),
    ).subscribe({
      next: (res) => {
        if (!res?.success) {
          this.titles = [];
          this.toast.presentToast(res?.message || 'Could not load this list.');
          return;
        }

        this.listTitle = (res?.listTitle ?? '').toString().trim() || this.listTitle;
        this.listDescription = (res?.listDescription ?? '').toString().trim();
        this.titles = Array.isArray(res?.titles) ? res.titles : [];
      },
      error: () => {
        this.titles = [];
        this.toast.presentToast('Could not load this list.');
      },
    });
  }

  titleText(t: AspenListTitle): string {
    return (t?.title ?? '').toString().trim() || 'Untitled';
  }

  authorText(t: AspenListTitle): string {
    return (t?.author ?? '').toString().trim();
  }

  coverUrl(t: AspenListTitle): string {
    const raw = (t?.image ?? t?.small_image ?? '').toString().trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    if (raw.startsWith('/')) return `${this.globals.aspen_discovery_base}${raw}`;
    return `${this.globals.aspen_discovery_base}/${raw}`;
  }

  async openTitle(t: AspenListTitle) {
    const recordType = (t?.recordType ?? '').toString().trim().toLowerCase();
    const url = (t?.['url'] ?? t?.titleURL ?? '').toString().trim();
    if (recordType === 'event' && url) {
      await this.globals.open_page(url);
      return;
    }

    const key = (t?.id ?? '').toString().trim();
    if (!key) {
      this.toast.presentToast('This list entry cannot be opened in-app yet.');
      return;
    }

    const hit: AspenSearchHit = {
      key,
      title: this.titleText(t),
      author: this.authorText(t) || undefined,
      coverUrl: (t?.image ?? '').toString().trim() || undefined,
      summary: (t?.description ?? '').toString().trim() || undefined,
      language: (t?.language ?? '').toString().trim() || undefined,
      format: t?.format,
      itemList: [],
      catalogUrl: `${this.globals.aspen_discovery_base}/GroupedWork/${encodeURIComponent(key)}`,
      raw: t,
    };

    const modal = await this.modalController.create({
      component: ItemDetailComponent,
      componentProps: {
        hit,
        listContext: {
          listId: this.listId,
          listTitle: this.listTitle,
          recordId: key,
        },
      },
    });
    this.globals.modal_open = true;
    modal.onDidDismiss().then((res) => {
      if (res?.data?.refreshList) this.refresh();
    });
    await modal.present();
  }

  async openTitleActions(t: AspenListTitle, ev?: Event) {
    ev?.stopPropagation();

    const sheet = await this.actionSheetCtrl.create({
      header: this.titleText(t),
      buttons: [
        {
          text: 'Open Details',
          handler: () => this.openTitle(t),
        },
        {
          text: 'Remove from List',
          role: 'destructive',
          handler: () => this.confirmRemoveFromList(t),
        },
        {
          text: 'Cancel',
          role: 'cancel',
        },
      ],
    });

    await sheet.present();
  }

  removeBusyFor(t: AspenListTitle): boolean {
    return this.removingRecordId !== '' && this.removingRecordId === this.recordIdForEntry(t);
  }

  private recordIdForEntry(t: AspenListTitle): string {
    const id = (t?.id ?? t?.shortId ?? '').toString().trim();
    return id;
  }

  private async confirmRemoveFromList(t: AspenListTitle) {
    if (this.mutatingBlockedForRemove(t)) return;

    const confirmSheet = await this.actionSheetCtrl.create({
      header: 'Remove from list?',
      subHeader: this.titleText(t),
      buttons: [
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => this.removeFromListNow(t),
        },
        {
          text: 'Cancel',
          role: 'cancel',
        },
      ],
    });

    await confirmSheet.present();
  }

  private mutatingBlockedForRemove(t: AspenListTitle): boolean {
    return this.removeBusyFor(t);
  }

  private removeFromListNow(t: AspenListTitle) {
    const recordId = this.recordIdForEntry(t);
    if (!recordId) {
      this.toast.presentToast('This title cannot be removed (missing record id).');
      return;
    }
    if (!this.listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }

    this.removingRecordId = recordId;
    this.listsService.removeTitlesFromList(this.listId, [recordId])
      .pipe(finalize(() => { this.removingRecordId = ''; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not remove title from list.');
            return;
          }

          this.titles = this.titles.filter(x => this.recordIdForEntry(x) !== recordId);
          this.toast.presentToast(res?.message || 'Removed from list.');
        },
        error: () => this.toast.presentToast('Could not remove title from list.'),
      });
  }

  trackByTitle(_idx: number, t: AspenListTitle): string {
    const id = (t?.id ?? '').toString().trim();
    return id || `${_idx}`;
  }
}
