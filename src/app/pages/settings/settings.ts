import { Component, ChangeDetectorRef, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GearItem, TierPreferenceKey } from '../../shared/models/item';
import { PreferencesService } from '../../services/preferences';
import { GearData } from '../../services/gear-data';

/** Settings page: per-slot tier preferences and the custom background image. */
@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss'],
})
export class SettingsPage implements OnInit {
  preferences = inject(PreferencesService);
  private gearData = inject(GearData);
  private platformId = inject(PLATFORM_ID);
  private cdr = inject(ChangeDetectorRef);

  /** Rows rendered in the tier-preference table. */
  slots: { key: TierPreferenceKey; label: string }[] = [
    { key: 'weapon', label: 'Weapon' },
    { key: 'offhand', label: 'Offhand' },
    { key: 'head', label: 'Head' },
    { key: 'chest', label: 'Chest' },
    { key: 'shoes', label: 'Shoes' },
    { key: 'cape', label: 'Cape' },
    { key: 'food', label: 'Food' },
    { key: 'potion', label: 'Potion' },
  ];

  catalog: GearItem[] = [];
  errorMessage = '';
  successMessage = '';
  /** Selectable explicit builds-per-column values (Auto is `null`). */
  readonly columnOptions: number[] = Array.from({ length: 20 }, (_, i) => i + 1);

  /** Loads the gear catalog only in the browser (prerender-safe). */
  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.gearData.getAvailableItems().subscribe((items) => {
      this.catalog = items;
      this.cdr.markForCheck();
    });
  }

  /** Tier labels available for a slot, derived from the catalog. */
  tierOptionsFor(slot: { key: TierPreferenceKey }): string[] {
    return this.preferences.tierOptionsFor(slot.key, this.catalog);
  }

  /** Persists a slot preference. */
  onTierChange(slot: TierPreferenceKey, value: string | null): void {
    this.preferences.setTierPreference(slot, value);
  }

  /** Effective preview source for the background image. */
  get previewSrc(): string {
    return this.preferences.backgroundImage ?? 'Background.jpg';
  }

  /** Reads the chosen file and starts the resize/compress pipeline. */
  onFileSelected(event: any): void {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.processImage(reader.result as string);
    reader.onerror = () => {
      this.errorMessage = 'Could not read the image file.';
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  }

  /** Clears the custom background back to the default. */
  resetBackground(): void {
    this.preferences.setBackground(null);
    this.preferences.applyBackground();
    this.errorMessage = '';
    this.successMessage = 'Background reset to default.';
  }

  /** Scales and JPEG-compresses the image, retrying until small enough. */
  private processImage(dataUrl: string): void {
    const img = new Image();
    img.onload = () => {
      let scale = Math.min(1, 1920 / Math.max(img.width, img.height));
      let quality = 0.8;
      let result = this.renderToDataUrl(img, scale, quality);
      let attempts = 0;

      while (result.length > 1500000 && attempts < 4) {
        attempts++;
        quality = Math.max(0.3, quality - 0.15);
        scale *= 0.85;
        result = this.renderToDataUrl(img, scale, quality);
      }

      if (!result || result.length > 1500000) {
        this.errorMessage =
          'The selected image is too large even after compression. Please choose a smaller image.';
        this.successMessage = '';
        this.cdr.markForCheck();
        return;
      }

      this.preferences.setBackground(result);
      this.preferences.applyBackground();
      this.errorMessage = '';
      this.successMessage = 'Background updated.';
      this.cdr.markForCheck();
    };
    img.onerror = () => {
      this.errorMessage = 'Could not load the selected image.';
      this.cdr.markForCheck();
    };
    img.src = dataUrl;
  }

  /** Draws the image at a scale and returns a JPEG data URL. */
  private renderToDataUrl(img: HTMLImageElement, scale: number, quality: number): string {
    const canvas = document.createElement('canvas');
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }
}
