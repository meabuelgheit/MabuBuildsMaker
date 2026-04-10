import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerBuild, SlotCategory, GearItem, BuildSwap } from '../../shared/models/item';
import { ItemSelector } from '../item-selector/item-selector';
import { GearData } from '../../services/gear-data';

@Component({
  selector: 'app-build-card',
  standalone: true,
  imports: [CommonModule, ItemSelector],
  templateUrl: './build-card.html',
  styleUrls: ['./build-card.scss'],
})
export class BuildCard {
  @Input() build!: PlayerBuild;
  @Input() hideUI = false;
  @Output() deleteRequest = new EventEmitter<void>();

  isSelectorOpen = false;
  activeSelectorCategory: SlotCategory | null = null;
  isSwapMode = false;
  availableTiers = ['', 'T8+', 'T9+', 'T10+'];

  constructor(public gearData: GearData) {}

  openSelector(category: SlotCategory, isSwap = false) {
    if (this.hideUI) return;
    this.activeSelectorCategory = category;
    this.isSwapMode = isSwap;
    this.isSelectorOpen = true;
  }

  handleItemSelected(item: GearItem) {
    if (this.activeSelectorCategory) {
      const category = this.activeSelectorCategory as unknown as keyof BuildSwap;
      if (this.isSwapMode) {
        if (!this.build.swaps[category]) this.build.swaps[category] = [];
        this.build.swaps[category].push(item);
      } else {
        if (this.activeSelectorCategory === 'weapon') {
          this.build.mainHand = item;
        } else {
          (this.build as any)[this.activeSelectorCategory] = item;
        }
      }
    }
    this.isSwapMode = false;
    this.isSelectorOpen = false;
  }

  removeSwap(category: string, index: number) {
    if (this.hideUI) return;
    const swapKey = category as keyof BuildSwap;
    if (this.build.swaps[swapKey]) this.build.swaps[swapKey].splice(index, 1);
  }

  cycleTier() {
    if (this.hideUI) return;
    const currentIndex = this.availableTiers.indexOf(this.build.minTier || '');
    const nextIndex = (currentIndex + 1) % this.availableTiers.length;
    this.build.minTier = this.availableTiers[nextIndex];
  }

  toggleApproval() {
    if (this.hideUI) return;
    this.build.requiresApproval = !this.build.requiresApproval;
  }
}
