import { Component, inject } from '@angular/core';
import { ToastService } from '../../services/toast';

/** Fixed bottom-center host rendering the transient toast queue. */
@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [],
  templateUrl: './toast-host.html',
  styleUrls: ['./toast-host.scss'],
})
export class ToastHost {
  toasts = inject(ToastService).toasts;
}
