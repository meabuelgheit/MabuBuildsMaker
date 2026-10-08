import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { UiStateService } from './services/ui-state';
import { ToastHost } from './components/toast-host/toast-host';

/** Thin application shell: toolbar, navigation and the routed content outlet. */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ToastHost],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  /** Shared zen-mode visibility flag consumed by the shell and pages. */
  uiState = inject(UiStateService);
}
