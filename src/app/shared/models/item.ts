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
}
