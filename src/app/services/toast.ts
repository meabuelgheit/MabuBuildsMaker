import { Injectable, signal } from '@angular/core';

/** A single transient notification. */
export interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error' | 'info';
}

/** Signal-backed toast queue, safe for use in a zoneless app. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private counter = 0;

  /** Pushes a toast that auto-dismisses after `duration` ms. */
  show(message: string, kind: 'success' | 'error' | 'info' = 'success', duration = 2600): void {
    const id = ++this.counter;
    this.toasts.update((list) => [...list, { id, message, kind }]);
    setTimeout(() => this.remove(id), duration);
  }

  /** Removes a toast by id. */
  remove(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
