import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  GearItem,
  GroupedItem,
  TierPreferenceKey,
  TierPreferences,
  categoryToTierSlot,
} from '../shared/models/item';
import { StorageService } from './storage';

/** Shape persisted under the preferences key. */
interface PreferencesState {
  tierPreferences: TierPreferences;
  backgroundImage: string | null;
  buildsPerColumn: number;
}

/** Clamps a builds-per-column value into the supported 1-20 range. */
function clampBuildsPerColumn(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.min(20, Math.max(1, Math.round(num)));
}

/** All preference slots with a `null` (ask each time) default. */
function defaultTierPreferences(): TierPreferences {
  return {
    weapon: null,
    offhand: null,
    head: null,
    chest: null,
    shoes: null,
    cape: null,
    food: null,
    potion: null,
  };
}

/**
 * Singleton store for per-slot tier preferences and the background image.
 * The background is applied through the global `--app-bg-image` CSS variable.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  tierPreferences: TierPreferences = defaultTierPreferences();
  backgroundImage: string | null = null;
  buildsPerColumn = 10;

  private platformId = inject(PLATFORM_ID);
  private storage = inject(StorageService);

  constructor() {
    const state = this.storage.read<Partial<PreferencesState>>(
      StorageService.PREFERENCES_KEY,
      {},
    );
    this.tierPreferences = {
      ...defaultTierPreferences(),
      ...(state.tierPreferences ?? {}),
    };
    this.backgroundImage =
      typeof state.backgroundImage === 'string' ? state.backgroundImage : null;
    this.buildsPerColumn = clampBuildsPerColumn(state.buildsPerColumn ?? 10);
    this.applyBackground();
  }

  /** Sets the builds-per-column count (clamped to 1-20) and persists. */
  setBuildsPerColumn(value: number): void {
    this.buildsPerColumn = clampBuildsPerColumn(value);
    this.persist();
  }

  /** Sets a slot preference (`null` = ask each time) and persists. */
  setTierPreference(slot: TierPreferenceKey, value: string | null): void {
    this.tierPreferences = { ...this.tierPreferences, [slot]: value };
    this.persist();
  }

  /** Sets the custom background data URL (`null` = default) and persists. */
  setBackground(dataUrl: string | null): void {
    this.backgroundImage = dataUrl;
    this.persist();
  }

  /** Derives the ascending tier labels available for a slot from the catalog. */
  tierOptionsFor(slot: TierPreferenceKey, catalog: GearItem[]): string[] {
    const labels = new Set<string>();
    for (const item of catalog) {
      if (categoryToTierSlot(item.category) !== slot) continue;
      const match = item.name.match(/^(\d+\.\d+)/);
      if (match) labels.add(match[1]);
    }
    return Array.from(labels).sort((a, b) => Number(a) - Number(b));
  }

  /** Picks the variation matching an exact tier label, or `null` to fall back. */
  resolveVariation(
    group: GroupedItem,
    preference: string | null,
  ): GearItem | null {
    if (!preference) return null;
    return (
      group.variations.find((v) => {
        const match = v.name.match(/^(\d+\.\d+)/);
        return match ? match[1] === preference : false;
      }) ?? null
    );
  }

  /** Applies or clears the custom background CSS variable (browser only). */
  applyBackground(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (typeof document === 'undefined') return;
    if (this.backgroundImage) {
      document.documentElement.style.setProperty(
        '--app-bg-image',
        'url("' + this.backgroundImage + '")',
      );
    } else {
      document.documentElement.style.removeProperty('--app-bg-image');
    }
  }

  private persist(): void {
    this.storage.write(StorageService.PREFERENCES_KEY, {
      tierPreferences: this.tierPreferences,
      backgroundImage: this.backgroundImage,
      buildsPerColumn: this.buildsPerColumn,
    } satisfies PreferencesState);
  }
}
