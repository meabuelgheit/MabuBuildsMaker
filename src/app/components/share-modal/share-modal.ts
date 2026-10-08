import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostListener,
  ChangeDetectorRef,
  ElementRef,
  ViewChild,
  inject,
} from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { BuildCollection, PlayerBuild } from '../../shared/models/item';
import { ShareImageService, ShareResult } from '../../services/share-image';
import { ToastService } from '../../services/toast';

/** Describes what the share modal should render. */
export type ShareRequest =
  | { kind: 'build'; build: PlayerBuild; subtitle?: string }
  | { kind: 'collection'; collection: BuildCollection }
  | { kind: 'collections'; collections: BuildCollection[] };

/** Modal that renders a share image, previews it, and offers download/copy. */
@Component({
  selector: 'app-share-modal',
  standalone: true,
  imports: [],
  templateUrl: './share-modal.html',
  styleUrls: ['./share-modal.scss'],
})
export class ShareModal implements OnChanges {
  @Input() open = false;
  @Input() request: ShareRequest | null = null;
  @Output() closed = new EventEmitter<void>();

  private shareImage = inject(ShareImageService);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);

  state: 'idle' | 'rendering' | 'done' | 'error' = 'idle';
  result: ShareResult | null = null;
  safeUrl: SafeUrl | null = null;
  errorMessage = '';

  private rawUrl: string | null = null;
  private renderToken = 0;
  /** Element that opened the modal, so focus can return to it on close. */
  private opener: HTMLElement | null = null;
  private panel: ElementRef<HTMLElement> | null = null;

  @ViewChild('panel')
  set panelRef(ref: ElementRef<HTMLElement> | undefined) {
    this.panel = ref ?? null;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open']) {
      if (this.open) {
        this.captureAndFocus();
        this.startRender();
      } else {
        this.cleanup();
      }
    }
  }

  /** Title describing the rendered content. */
  get title(): string {
    const req = this.request;
    if (!req) return 'Share';
    if (req.kind === 'build') return 'Share build';
    if (req.kind === 'collections') return 'Share all';
    return req.collection.type === 'group' ? 'Share group' : 'Share party';
  }

  /** Remembers the opener and moves focus into the modal panel. */
  private captureAndFocus(): void {
    if (typeof document === 'undefined') return;
    this.opener = (document.activeElement as HTMLElement) ?? null;
    setTimeout(() => {
      if (this.open) this.panel?.nativeElement.focus();
    }, 0);
  }

  /** Returns focus to the element that opened the modal (if still present). */
  private restoreFocus(): void {
    if (typeof document === 'undefined') return;
    const el = this.opener;
    this.opener = null;
    if (el && el.isConnected && typeof el.focus === 'function') el.focus();
  }

  /** True when the browser can write images to the clipboard. */
  get canCopy(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem !== 'undefined'
    );
  }

  /** Kicks off (or retries) rendering the current request. */
  async startRender(): Promise<void> {
    if (!this.request) return;
    const token = ++this.renderToken;
    this.state = 'rendering';
    this.errorMessage = '';
    this.cdr.markForCheck();
    try {
      const req = this.request;
      const res =
        req.kind === 'build'
          ? await this.shareImage.renderBuild(req.build, { subtitle: req.subtitle })
          : req.kind === 'collections'
            ? await this.shareImage.renderCollections(req.collections)
            : await this.shareImage.renderCollection(req.collection);
      if (token !== this.renderToken) return; // stale render
      this.setImage(res.blob);
      this.result = res;
      this.state = 'done';
      if (res.missingIcons > 0) {
        this.toast.show(`${res.missingIcons} icon(s) could not be loaded.`, 'info');
      }
    } catch {
      if (token !== this.renderToken) return;
      this.state = 'error';
      this.errorMessage = 'Could not render the share image.';
    }
    this.cdr.markForCheck();
  }

  /** Downloads the rendered card as JPEG (falls back to the PNG on failure). */
  async download(): Promise<void> {
    if (!this.result) return;
    const jpeg = await this.shareImage.toJpeg(this.result.blob).catch(() => null);
    const blob = jpeg ?? this.result.blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName(jpeg ? 'jpg' : 'png');
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Copies the rendered PNG to the clipboard. */
  async copy(): Promise<void> {
    if (!this.result || !this.canCopy) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': this.result.blob }),
      ]);
      this.toast.show('Image copied to clipboard.');
    } catch {
      this.toast.show('Could not copy the image.', 'error');
    }
  }

  /** Closes the modal and asks the host to update its open flag. */
  close(): void {
    this.revoke();
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  private cleanup(): void {
    this.renderToken++;
    this.revoke();
    this.state = 'idle';
    this.result = null;
    this.errorMessage = '';
    this.restoreFocus();
  }

  private setImage(blob: Blob): void {
    this.revoke();
    const url = URL.createObjectURL(blob);
    this.rawUrl = url;
    this.safeUrl = this.sanitizer.bypassSecurityTrustUrl(url);
  }

  private revoke(): void {
    if (this.rawUrl) {
      URL.revokeObjectURL(this.rawUrl);
      this.rawUrl = null;
    }
    this.safeUrl = null;
  }

  private fileName(ext: 'png' | 'jpg' = 'png'): string {
    const req = this.request;
    const base =
      req?.kind === 'build'
        ? req.build.title
        : req?.kind === 'collections'
          ? 'all-groups'
          : req?.kind === 'collection'
            ? req.collection.name
            : 'share';
    const slug =
      (base || 'share')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'share';
    return `mabu-${slug}.${ext}`;
  }
}
