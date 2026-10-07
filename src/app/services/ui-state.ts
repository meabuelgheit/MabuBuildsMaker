import { Injectable } from '@angular/core';

/** Transient UI visibility flag shared between the shell and pages. */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  hideUI = false;

  toggle(): void {
    this.hideUI = !this.hideUI;
  }

  set(value: boolean): void {
    this.hideUI = value;
  }
}
