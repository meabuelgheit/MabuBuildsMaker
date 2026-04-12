import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GearItem, SlotCategory, GroupedItem } from '../../shared/models/item';
import { GearData } from '../../services/gear-data';

@Component({
  selector: 'app-item-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './item-selector.html',
  styleUrls: ['./item-selector.scss'],
})
export class ItemSelector implements OnInit, OnDestroy {
  @Input() isOpen = false;
  @Input() category: SlotCategory | null = null;
  @Input() isSwapMode = false;

  @Output() itemSelected = new EventEmitter<GearItem>();
  @Output() close = new EventEmitter<void>();

  searchQuery = '';
  allItems: GearItem[] = [];
  groupedItems: GroupedItem[] = [];

  step: 'base' | 'tier' = 'base';
  selectedGroup: GroupedItem | null = null;

  constructor(
    public gearData: GearData,
    private el: ElementRef,
  ) {}

  ngOnInit() {
    document.body.appendChild(this.el.nativeElement);

    this.gearData.getAvailableItems().subscribe((items) => {
      this.allItems = items;
      this.groupItems();
    });
  }

  ngOnDestroy() {
    if (this.el.nativeElement && this.el.nativeElement.parentNode) {
      this.el.nativeElement.parentNode.removeChild(this.el.nativeElement);
    }
  }

  groupItems() {
    const groups = new Map<string, GroupedItem>();

    this.allItems.forEach((item) => {
      let baseName = item.name.replace(/^(\d+\.\d+\s+|T\d\s+)/, '');

      if (!groups.has(baseName)) {
        groups.set(baseName, {
          name: baseName,
          category: item.category,
          variations: [],
        });
      }
      groups.get(baseName)!.variations.push(item);
    });

    this.groupedItems = Array.from(groups.values());
  }

  get filteredGroups(): GroupedItem[] {
    return this.groupedItems.filter((group) => {
      let matchesCategory = false;

      if (this.category === 'weapon') {
        if (this.isSwapMode) {
          matchesCategory =
            group.category === 'weapon1h' ||
            group.category === 'weapon2h' ||
            group.category === 'offhand';
        } else {
          matchesCategory = group.category === 'weapon1h' || group.category === 'weapon2h';
        }
      } else if (this.category) {
        matchesCategory = group.category === this.category;
      }

      const matchesSearch = group.name.toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }

  get organizedTiers() {
    if (!this.selectedGroup) return [];
    const tiersMap = new Map<string, GearItem[]>();

    this.selectedGroup.variations.forEach((item: GearItem) => {
      const match = item.name.match(/^(\d+)\./);
      const tier = match ? match[1] : 'Base';

      if (!tiersMap.has(tier)) {
        tiersMap.set(tier, []);
      }
      tiersMap.get(tier)!.push(item);
    });

    return Array.from(tiersMap.entries())
      .map(([tier, items]) => ({
        tier,
        items: items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      }))
      .sort((a, b) => {
        if (a.tier === 'Base') return -1;
        return Number(a.tier) - Number(b.tier);
      });
  }

  selectGroup(group: GroupedItem) {
    if (group.variations.length === 1) {
      this.selectVariation(group.variations[0]);
    } else {
      this.selectedGroup = group;
      this.step = 'tier';
    }
  }

  selectVariation(item: GearItem) {
    this.itemSelected.emit(item);
    this.closeModal();
  }

  goBack() {
    this.step = 'base';
    this.selectedGroup = null;
  }

  closeModal() {
    this.searchQuery = '';
    this.step = 'base';
    this.selectedGroup = null;
    this.close.emit();
  }

  getTierLabel(name: string): string {
    const match = name.match(/^(\d+\.\d+)/);
    return match ? match[0] : name;
  }
}
