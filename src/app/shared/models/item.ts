export type ItemCategory =
  | 'weapon1h'
  | 'weapon2h'
  | 'offhand'
  | 'head'
  | 'chest'
  | 'shoes'
  | 'cape'
  | 'food'
  | 'potion';

export type SlotCategory =
  | 'weapon'
  | 'offhand'
  | 'head'
  | 'chest'
  | 'shoes'
  | 'cape'
  | 'food'
  | 'potion';

export interface GearItem {
  id: string;
  name: string;
  category: ItemCategory;
}

export interface GroupedItem {
  name: string;
  category: ItemCategory;
  variations: GearItem[];
}

export interface BuildSwap {
  weapon: GearItem[];
  head: GearItem[];
  chest: GearItem[];
  shoes: GearItem[];
  cape: GearItem[];
  food: GearItem[];
  potion: GearItem[];
}

export interface PlayerBuild {
  id: string;
  title: string;
  mainHand: GearItem | null;
  head: GearItem | null;
  chest: GearItem | null;
  shoes: GearItem | null;
  cape: GearItem | null;
  food: GearItem | null;
  potion: GearItem | null;
  swaps: BuildSwap;
  requiresApproval: boolean;
  minTier: string;
  tags?: string[];
}

/** A saved party or group of builds with UI visibility metadata. */
export interface BuildCollection {
  id: string;
  name: string;
  type: 'party' | 'group';
  builds: PlayerBuild[];
  isVisibleInViewMode: boolean;
  /** Epoch millis of the last content change, used by the Groups page. */
  updatedAt?: number;
}

/** Slots that can carry an exact per-slot tier preference. */
export type TierPreferenceKey =
  | 'weapon'
  | 'offhand'
  | 'head'
  | 'chest'
  | 'shoes'
  | 'cape'
  | 'food'
  | 'potion';

/** Maps each preference slot to a chosen tier label (`null` = ask each time). */
export type TierPreferences = Record<TierPreferenceKey, string | null>;

/** A build saved into the permanent library. */
export interface SavedBuild {
  id: string;
  name: string;
  savedAt: number;
  build: PlayerBuild;
}

/** A collection moved into the permanent archive. */
export interface ArchivedCollection {
  archivedAt: number;
  collection: BuildCollection;
}

/** Maps a concrete item category to the slot key used for tier preferences. */
export function categoryToTierSlot(category: ItemCategory): TierPreferenceKey {
  if (category === 'weapon1h' || category === 'weapon2h') return 'weapon';
  return category;
}

/** Extracts the `T.t` tier label from an item name, falling back to the name. */
export function tierLabel(name: string): string {
  const match = name.match(/^(\d+\.\d+)/);
  return match ? match[0] : name;
}
