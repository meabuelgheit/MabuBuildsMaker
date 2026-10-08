import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PlayerBuild, SlotCategory, GearItem, BuildSwap, tierLabel as itemTierLabel } from '../../shared/models/item';
import { ItemSelector } from '../item-selector/item-selector';
import { GearData } from '../../services/gear-data';
import { WorkspaceService } from '../../services/workspace';
import { LibraryService } from '../../services/library';
import { PreferencesService } from '../../services/preferences';
import { ToastService } from '../../services/toast';

/** A single equipable slot rendered on the card. */
interface BuildSlot {
  key: keyof BuildSwap;
  placeholder: string;
}

@Component({
  selector: 'app-build-card',
  standalone: true,
  imports: [FormsModule, ItemSelector],
  templateUrl: './build-card.html',
  styleUrls: ['./build-card.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BuildCard {
  @Input() build!: PlayerBuild;
  @Input() hideUI = false;
  @Input() isFirst = false;
  @Input() isLast = false;
  /** When true, the first main-hand slot loads eagerly as the page LCP image. */
  @Input() eager = false;

  @Output() deleteRequest = new EventEmitter<void>();
  @Output() duplicateRequest = new EventEmitter<void>();
  @Output() moveUp = new EventEmitter<void>();
  @Output() moveDown = new EventEmitter<void>();
  @Output() shareRequest = new EventEmitter<void>();

  /** Maps each swap slot to its single-item field on PlayerBuild. */
  private static readonly FIELD: Record<keyof BuildSwap, keyof PlayerBuild> = {
    weapon: 'mainHand',
    head: 'head',
    chest: 'chest',
    shoes: 'shoes',
    cape: 'cape',
    food: 'food',
    potion: 'potion',
  };

  readonly slots: BuildSlot[] = [
    { key: 'weapon', placeholder: '+ Weapon/Off' },
    { key: 'head', placeholder: '+ Head' },
    { key: 'chest', placeholder: '+ Chest' },
    { key: 'shoes', placeholder: '+ Shoes' },
    { key: 'cape', placeholder: '+ Cape' },
    { key: 'food', placeholder: '+ Food' },
    { key: 'potion', placeholder: '+ Pot' },
  ];

  isSelectorOpen = false;
  activeSelectorCategory: SlotCategory | null = null;
  isSwapMode = false;
  availableTiers = ['', 'T4+', 'T5+', 'T6+', 'T7+', 'T8+'];

  newTag = '';
  savedConfirmation = false;

  /** Exposed so the template can render per-slot tier labels. */
  readonly tierLabel = itemTierLabel;

  gearData = inject(GearData);
  workspace = inject(WorkspaceService);
  preferences = inject(PreferencesService);
  private library = inject(LibraryService);
  private toast = inject(ToastService);
  private cdr = inject(ChangeDetectorRef);

  /** The equipped item for a slot, or null when empty. */
  itemFor(slot: BuildSlot): GearItem | null {
    return (this.build[BuildCard.FIELD[slot.key]] as GearItem | null) ?? null;
  }

  /** The swap items stored for a slot. */
  swapsFor(slot: BuildSlot): GearItem[] {
    return this.build.swaps[slot.key] ?? [];
  }

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
          if (this.build.title === 'New Build' || this.build.title.trim() === '') {
            const cleanName = item.name.replace(/^(\d+\.\d+\s+|T\d\s+)/, '').trim();
            this.build.title = cleanName;
          }
          this.build.mainHand = item;
        } else {
          (this.build as any)[this.activeSelectorCategory] = item;
        }
      }
      this.touch();
    }
    this.isSwapMode = false;
    this.isSelectorOpen = false;
  }

  removeSwap(category: string, index: number) {
    if (this.hideUI) return;
    const swapKey = category as keyof BuildSwap;
    if (this.build.swaps[swapKey]) {
      this.build.swaps[swapKey].splice(index, 1);
      this.touch();
    }
  }

  cycleTier() {
    if (this.hideUI) return;
    const currentIndex = this.availableTiers.indexOf(this.build.minTier || '');
    const nextIndex = (currentIndex + 1) % this.availableTiers.length;
    this.build.minTier = this.availableTiers[nextIndex];
    this.touch();
  }

  toggleApproval() {
    if (this.hideUI) return;
    this.build.requiresApproval = !this.build.requiresApproval;
    this.touch();
  }

  addTag(event?: Event) {
    if (event) event.preventDefault();
    const tag = this.newTag.trim();
    if (tag) {
      if (!this.build.tags) this.build.tags = [];
      this.build.tags.push(tag);
      this.newTag = '';
      this.touch();
    }
  }

  removeTag(index: number) {
    if (this.build.tags) {
      this.build.tags.splice(index, 1);
      this.touch();
    }
  }

  /** Persists the current build into the library with brief confirmation. */
  saveToLibrary() {
    if (this.hideUI) return;
    this.library.save(this.build);
    this.savedConfirmation = true;
    this.toast.show('Saved to library.');
    setTimeout(() => {
      this.savedConfirmation = false;
      this.cdr.markForCheck();
    }, 1500);
  }

  /** Forwards a mutation to the debounced workspace persistence. */
  touch() {
    this.workspace.touch();
  }
}
