import { Component, OnDestroy, OnInit, inject } from '@angular/core';

import {
  IonicModule,
  ActionSheetController,
  AlertController,
} from '@ionic/angular/lazy';
import { Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';

import { Globals } from '../../globals';
import { ToastService } from '../../services/toast.service';
import { ListsService, type AspenUserList } from '../../services/lists.service';
import { ListLookupService } from '../../services/list-lookup.service';
import { AuthService } from '../../services/auth.service';

interface ListViewContext {
  accountId: string;
  revision: number;
}

@Component({
  standalone: true,
  selector: 'app-my-lists',
  templateUrl: './my-lists.page.html',
  styleUrls: ['./my-lists.page.scss'],
  imports: [IonicModule],
})
export class MyListsPage implements OnInit, OnDestroy {
  globals = inject(Globals);
  private listsService = inject(ListsService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private actionSheetCtrl = inject(ActionSheetController);
  private alertCtrl = inject(AlertController);
  private listLookup = inject(ListLookupService);
  private auth = inject(AuthService);
  private refreshSubscription?: Subscription;
  private displayedAccountId: string | null = null;
  private viewRevision = 0;
  private authSubscription?: Subscription;

  loading = false;
  mutating = false;
  lists: AspenUserList[] = [];

  ngOnInit() {
    let accountId = this.auth.snapshot().activeAccountId;
    this.authSubscription = this.auth.authState().subscribe(state => {
      const nextAccountId = state.isLoggedIn ? state.activeAccountId : null;
      if (accountId === nextAccountId) return;
      accountId = nextAccountId;
      this.viewRevision += 1;
      this.mutating = false;
      this.refreshSubscription?.unsubscribe();
      this.lists = [];
      this.displayedAccountId = nextAccountId;
    });
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
    this.ionViewDidLeave();
  }

  async ionViewWillEnter() {
    this.viewRevision += 1;
    this.mutating = false;
    this.refresh();
  }

  ionViewDidLeave() {
    this.viewRevision += 1;
    this.mutating = false;
    this.refreshSubscription?.unsubscribe();
  }

  private viewContext(): ListViewContext | null {
    const snapshot = this.auth.snapshot();
    return snapshot.isLoggedIn && snapshot.activeAccountId
      ? { accountId: snapshot.activeAccountId, revision: this.viewRevision }
      : null;
  }

  private isCurrentView(context: ListViewContext | null): boolean {
    const snapshot = this.auth.snapshot();
    return !!context && snapshot.isLoggedIn && snapshot.activeAccountId === context.accountId &&
      this.viewRevision === context.revision;
  }

  refresh(ev?: any) {
    const accountId = this.auth.snapshot().activeAccountId;
    if (this.displayedAccountId !== accountId) {
      this.viewRevision += 1;
      this.mutating = false;
      this.refreshSubscription?.unsubscribe();
      this.lists = [];
      this.displayedAccountId = accountId;
    }
    if (!accountId) {
      ev?.target?.complete?.();
      return;
    }
    if (this.loading) {
      ev?.target?.complete?.();
      return;
    }

    this.loading = true;
    this.refreshSubscription = this.listsService
      .fetchUserLists()
      .pipe(
        finalize(() => {
          this.loading = false;
          ev?.target?.complete?.();
        })
      )
      .subscribe({
        next: (lists) => {
          if (this.auth.snapshot().activeAccountId !== accountId) return;
          this.lists = (lists ?? []).slice().sort((a, b) => {
            const ta =
              new Date((a?.dateUpdated ?? '').toString()).getTime() || 0;
            const tb =
              new Date((b?.dateUpdated ?? '').toString()).getTime() || 0;
            return tb - ta;
          });
          this.listLookup.replaceLists(this.lists);
        },
        error: () => {
          if (this.auth.snapshot().activeAccountId !== accountId) return;
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
    const context = this.viewContext();
    if (this.mutating || !context) return;

    const basics = await this.promptListBasics('Create List', '', '', context);
    if (!basics || !this.isCurrentView(context)) return;

    const isPublic = await this.promptVisibility(false, context);
    if (isPublic === null || !this.isCurrentView(context)) return;

    this.mutating = true;
    this.listsService
      .createList(basics.title, basics.description, isPublic)
      .pipe(
        finalize(() => {
          if (this.isCurrentView(context)) this.mutating = false;
        })
      )
      .subscribe({
        next: (res) => {
          if (!this.isCurrentView(context)) return;
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not create list.');
            return;
          }
          this.toast.presentToast(res?.message || 'List created.');
          this.refresh();
        },
        error: () => { if (this.isCurrentView(context)) this.toast.presentToast('Could not create list.'); },
      });
  }

  async openListActions(list: AspenUserList, ev?: Event) {
    ev?.stopPropagation();
    const context = this.viewContext();
    if (this.mutating || !context) return;

    const sheet = await this.actionSheetCtrl.create({
      header: this.listTitle(list),
      buttons: [
        {
          text: 'Open List',
          handler: () => { if (this.isCurrentView(context)) this.openList(list); },
        },
        {
          text: 'Edit List',
          handler: () => { if (this.isCurrentView(context)) void this.editList(list); },
        },
        {
          text: 'Delete List',
          role: 'destructive',
          handler: () => { if (this.isCurrentView(context)) void this.confirmDeleteList(list); },
        },
        {
          text: 'Close',
          role: 'cancel',
        },
      ],
    });

    if (!this.isCurrentView(context)) { sheet.remove(); return; }
    await sheet.present();
  }

  async editList(list: AspenUserList) {
    const context = this.viewContext();
    if (this.mutating || !context) return;

    const basics = await this.promptListBasics(
      'Edit List',
      this.listTitle(list),
      this.listDescription(list),
      context
    );
    if (!basics || !this.isCurrentView(context)) return;

    const isPublic = await this.promptVisibility(!!list?.public, context);
    if (isPublic === null || !this.isCurrentView(context)) return;

    const listId = (list?.id ?? '').toString().trim();
    if (!listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }

    this.mutating = true;
    this.listsService
      .editList(listId, {
        title: basics.title,
        description: basics.description,
        isPublic,
      })
      .pipe(
        finalize(() => {
          if (this.isCurrentView(context)) this.mutating = false;
        })
      )
      .subscribe({
        next: (res) => {
          if (!this.isCurrentView(context)) return;
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not update list.');
            return;
          }
          this.listLookup.renameList(listId, basics.title);
          this.toast.presentToast(res?.message || 'List updated.');
          this.refresh();
        },
        error: () => { if (this.isCurrentView(context)) this.toast.presentToast('Could not update list.'); },
      });
  }

  async confirmDeleteList(list: AspenUserList) {
    const context = this.viewContext();
    if (this.mutating || !context) return;

    const count = this.listCount(list);
    const title = this.listTitle(list);
    const itemText = `${count} item${count === 1 ? '' : 's'}`;
    const warning =
      count > 0
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
          handler: () => this.deleteList(list, context),
        },
      ],
    });

    if (!this.isCurrentView(context)) { alert.remove(); return; }
    await alert.present();
  }

  private deleteList(list: AspenUserList, context = this.viewContext()) {
    if (!this.isCurrentView(context)) return;
    const listId = (list?.id ?? '').toString().trim();
    if (!listId) {
      this.toast.presentToast('This list is missing an id.');
      return;
    }
    if (this.mutating) return;

    this.mutating = true;
    this.listsService
      .deleteList(listId)
      .pipe(
        finalize(() => {
          if (this.isCurrentView(context)) this.mutating = false;
        })
      )
      .subscribe({
        next: (res) => {
          if (!this.isCurrentView(context)) return;
          if (!res?.success) {
            this.toast.presentToast(res?.message || 'Could not delete list.');
            return;
          }
          this.lists = this.lists.filter(
            (x) => (x?.id ?? '').toString().trim() !== listId
          );
          this.listLookup.removeList(listId);
          this.toast.presentToast(res?.message || 'List deleted.');
        },
        error: () => { if (this.isCurrentView(context)) this.toast.presentToast('Could not delete list.'); },
      });
  }

  private async promptListBasics(
    header: string,
    initialTitle = '',
    initialDescription: string,
    context: ListViewContext
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
              if (!this.isCurrentView(context)) { resolve(null); return true; }
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

      if (!this.isCurrentView(context)) { alert.remove(); resolve(null); return; }
      void alert.onDidDismiss().then(() => resolve(null));
      await alert.present();
    });
  }

  private async promptVisibility(
    initialPublic: boolean,
    context: ListViewContext
  ): Promise<boolean | null> {
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
              if (!this.isCurrentView(context)) { resolve(null); return true; }
              resolve((value ?? 'private').toString() === 'public');
              return true;
            },
          },
        ],
      });

      if (!this.isCurrentView(context)) { alert.remove(); resolve(null); return; }
      void alert.onDidDismiss().then(() => resolve(null));
      await alert.present();
    });
  }

  trackByList(_idx: number, list: AspenUserList): string {
    return (list?.id ?? '').toString();
  }
}
