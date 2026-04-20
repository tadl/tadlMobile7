import { Injectable } from '@angular/core';
import { Observable, defer, finalize, from, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UserApiQueueService {
  private tails = new Map<string, Promise<void>>();

  run<T>(key: string | null | undefined, factory: () => Observable<T>): Observable<T> {
    const queueKey = (key ?? '').toString().trim() || 'anonymous';

    return defer(() => {
      const previous = this.tails.get(queueKey) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const nextTail = previous.catch(() => {}).then(() => current);
      this.tails.set(queueKey, nextTail);

      return from(previous.catch(() => {})).pipe(
        switchMap(() => factory()),
        finalize(() => {
          release();
          if (this.tails.get(queueKey) === nextTail) {
            this.tails.delete(queueKey);
          }
        }),
      );
    });
  }
}
