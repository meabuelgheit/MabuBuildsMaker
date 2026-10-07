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
  buildsPerColumn: number | null;
}

/** Clamps a builds-per-column value into 1-20; null/absent means Auto. */
function clampBuildsPerColumn(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
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
  /** `null` = Auto (party 10 / group 6); a number is an explicit override. */
  buildsPerColumn: number | null = null;

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
    this.buildsPerColumn = clampBuildsPerColumn(state.buildsPerColumn);
    this.applyBackground();
  }

  /** Sets the builds-per-column count (`null` = Auto) and persists. */
  setBuildsPerColumn(value: number | null): void {
    this.buildsPerColumn = clampBuildsPerColumn(value);
    this.persist();
  }

  /** Returns a serializable copy of all preferences for export. */
  snapshot(): {
    tierPreferences: TierPreferences;
    backgroundImage: string | null;
    buildsPerColumn: number | null;
  } {
    return {
      tierPreferences: { ...this.tierPreferences },
      backgroundImage: this.backgroundImage,
      buildsPerColumn: this.buildsPerColumn,
    };
  }

  /** Replaces all preferences from an imported backup and persists. */
  replaceAll(prefs: Partial<PreferencesState> | null | undefined): void {
    this.tierPreferences = {
      ...defaultTierPreferences(),
      ...(prefs?.tierPreferences ?? {}),
    };
    this.backgroundImage =
      typeof prefs?.backgroundImage === 'string' ? prefs.backgroundImage : null;
    this.buildsPerColumn = clampBuildsPerColumn(prefs?.buildsPerColumn);
    this.persist();
    this.applyBackground();
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
