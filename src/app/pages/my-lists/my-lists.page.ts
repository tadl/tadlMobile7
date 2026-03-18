import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ActionSheetController, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';
import { ListLookupService } from '../../services/list-lookup.service';

@Component({
  standalone: true,
  selector: 'app-my-lists',
  templateUrl: './my-lists.page.html',
  styleUrls: ['./my-lists.page.scss'],
  imports: [CommonModule, IonicModule],
})
export class MyListsPage {
  loading = false;
  mutating = false;
  lists: AspenUserList[] = [];

  constructor(
    public globals: Globals,
    private listsService: ListsService,
    private toast: ToastService,
    private router: Router,
    private actionSheetCtrl: ActionSheetController,
    private alertCtrl: AlertController,
    private listLookup: ListLookupService,
  ) {}

  async ionViewWillEnter() {
    this.refresh();
  }

  refresh(ev?: any) {
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.listsService
      .fetchUserLists()
      .pipe(
        finalize(() => {
          this.loading = false;
          ev?.target?.complete?.();
        }),
      )
      .subscribe({
        next: (lists) => {
          this.lists = (lists ?? []).slice().sort((a, b) => {
            const ta = new Date((a?.dateUpdated ?? '').toString()).getTime() || 0;
            const tb = new Date((b?.dateUpdated ?? '').toString()).getTime() || 0;
            return tb - ta;
          });
        },
        error: () => {
          this.lists = [];
          this.toast.presentToast('Could not load your lists.');
        },
      });
  }

  listTitle(list: AspenUserList): string {
    return (list?.title ?? '').toString().trim() || 'Untitled list';
  }

  listDescription(list: AspenUserList): string {
    return (list?.description ?? '').toString().trim();
  }

  listCount(list: AspenUserList): number {
    const n = Number(list?.numTitles ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  openList(list: AspenUserList) {
    const id = (list?.id ?? '').toString().trim();
    if (!id) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }
    this.router.navigate(['/my-lists', id], {
      queryParams: { title: this.listTitle(list) },
    });
  }

  async createList() {
    if (this.mutating) return;

    const basics = await this.promptListBasics('Create List');
    if (!basics) return;

    const isPublic = await this.promptVisibility(false);
    if (isPublic === null) return;

    this.mutating = true;
    this.listsService.createList(basics.title, basics.description, isPublic)
      .pipe(finalize(() => { this.mutating = false; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not create list.');
            return;
          }
          this.toast.presentToast(res?.message || 'List created.');
          this.refresh();
        },
        error: () => this.toast.presentToast('Could not create list.'),
      });
  }

  async openListActions(list: AspenUserList, ev?: Event) {
    ev?.stopPropagation();
    if (this.mutating) return;

    const sheet = await this.actionSheetCtrl.create({
      header: this.listTitle(list),
      buttons: [
        {
          text: 'Open List',
          handler: () => this.openList(list),
        },
        {
          text: 'Edit List',
          handler: () => this.editList(list),
        },
        {
          text: 'Delete List',
          role: 'destructive',
          handler: () => this.confirmDeleteList(list),
        },
        {
          text: 'Close', role: 'cancel',
        },
      ],
    });

    await sheet.present();
  }

  async editList(list: AspenUserList) {
    if (this.mutating) return;

    const basics = await this.promptListBasics(
      'Edit List',
      this.listTitle(list),
      this.listDescription(list),
    );
    if (!basics) return;

    const isPublic = await this.promptVisibility(!!list?.public);
    if (isPublic === null) return;

    const listId = (list?.id ?? '').toString().trim();
    if (!listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }

    this.mutating = true;
    this.listsService.editList(listId, {
      title: basics.title,
      description: basics.description,
      isPublic,
    })
      .pipe(finalize(() => { this.mutating = false; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not update list.');
            return;
          }
          this.listLookup.renameList(listId, basics.title);
          this.toast.presentToast(res?.message || 'List updated.');
          this.refresh();
        },
        error: () => this.toast.presentToast('Could not update list.'),
      });
  }

  async confirmDeleteList(list: AspenUserList) {
    if (this.mutating) return;

    const count = this.listCount(list);
    const title = this.listTitle(list);
    const itemText = `${count} item${count === 1 ? '' : 's'}`;
    const warning = count > 0
      ? `THIS LIST HAS ${itemText.toUpperCase()} IN IT. ARE YOU SURE?`
      : 'Are you sure you want to delete this list?';

    const alert = await this.alertCtrl.create({
      header: 'Delete list?',
      subHeader: title,
      message: `${warning}\n\nThis cannot be undone.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete List',
          role: 'destructive',
          handler: () => this.deleteList(list),
        },
      ],
    });

    await alert.present();
  }

  private deleteList(list: AspenUserList) {
    const listId = (list?.id ?? '').toString().trim();
    if (!listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }
    if (this.mutating) return;

    this.mutating = true;
    this.listsService.deleteList(listId)
      .pipe(finalize(() => { this.mutating = false; }))
      .subscribe({
        next: (res) => {
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not delete list.');
            return;
          }
          this.lists = this.lists.filter(x => (x?.id ?? '').toString().trim() !== listId);
          this.listLookup.removeList(listId);
          this.toast.presentToast(res?.message || 'List deleted.');
        },
        error: () => this.toast.presentToast('Could not delete list.'),
      });
  }

  private async promptListBasics(
    header: string,
    initialTitle = '',
    initialDescription = '',
  ): Promise<{ title: string; description: string } | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header,
        inputs: [
          {
            name: 'title',
            type: 'text',
            placeholder: 'List title',
            value: initialTitle,
          },
          {
            name: 'description',
            type: 'textarea',
            placeholder: 'Description (optional)',
            value: initialDescription,
          },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'Continue',
            handler: (data) => {
              const title = (data?.title ?? '').toString().trim();
              const description = (data?.description ?? '').toString().trim();

              if (!title) {
                this.toast.presentToast('List title is required.');
                return false;
              }

              resolve({ title, description });
              return true;
            },
          },
        ],
      });

      await alert.present();
    });
  }

  private async promptVisibility(initialPublic: boolean): Promise<boolean | null> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'List Visibility',
        message: 'Choose whether this list is private or public.',
        inputs: [
          {
            type: 'radio',
            label: 'Private',
            value: 'private',
            checked: !initialPublic,
          },
          {
            type: 'radio',
            label: 'Public',
            value: 'public',
            checked: initialPublic,
          },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel', handler: () => resolve(null) },
          {
            text: 'Save',
            handler: (value) => {
              resolve((value ?? 'private').toString() === 'public');
              return true;
            },
          },
        ],
      });

      await alert.present();
    });
  }

  trackByList(_idx: number, list: AspenUserList): string {
    return (list?.id ?? '').toString();
  }
}
