import { Injectable, OnDestroy, signal } from '@angular/core';

/** A single transient notification. */
export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

/** Signal-backed toast queue, safe for use in a zoneless app. */
@Injectable({ providedIn: 'root' })
export class ToastService implements OnDestroy {
  readonly toasts = signal<Toast[]>([]);
  private counter = 0;
  /** Auto-dismiss timers keyed by toast id, so early removal can cancel them. */
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Pushes a toast that auto-dismisses after `duration` ms. */
  show(message: string, kind: 'success' | 'error' | 'info' = 'success', duration = 2600): void {
    const id = ++this.counter;
    this.toasts.update((list) => [...list, { id, message, kind }]);
    this.timers.set(id, setTimeout(() => this.remove(id), duration));
  }

  /** Removes a toast by id, cancelling its pending auto-dismiss timer. */
  remove(id: number): void {
    // Harmless when the timer itself triggered this removal.
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Clears every outstanding auto-dismiss timer on service teardown. */
  ngOnDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
