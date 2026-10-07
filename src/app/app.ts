import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UiStateService } from './services/ui-state';

/** Thin application shell: toolbar, navigation and the routed content outlet. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  /** Shared zen-mode visibility flag consumed by the shell and pages. */
  uiState = inject(UiStateService);
}
