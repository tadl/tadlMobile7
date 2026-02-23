import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class LoadingService {
  private inFlight = 0;
  private isLoadingSubject = new BehaviorSubject<boolean>(false);

  isLoading$(): Observable<boolean> {
    return this.isLoadingSubject.asObservable();
  }

  start(): void {
    this.inFlight += 1;
    if (this.inFlight === 1) this.isLoadingSubject.next(true);
  }

  stop(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight === 0) this.isLoadingSubject.next(false);
  }

  reset(): void {
    this.inFlight = 0;
    this.isLoadingSubject.next(false);
  }
}
