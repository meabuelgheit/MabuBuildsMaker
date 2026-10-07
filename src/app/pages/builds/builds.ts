import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GearItem, PlayerBuild, SavedBuild } from '../../shared/models/item';
import { LibraryService } from '../../services/library';
import { WorkspaceService } from '../../services/workspace';
import { GearData } from '../../services/gear-data';

/** Builds page: browse, rename, delete and insert saved builds. */
@Component({
  selector: 'app-builds-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './builds.html',
  styleUrls: ['./builds.scss'],
})
export class BuildsPage {
  library = inject(LibraryService);
  workspace = inject(WorkspaceService);
  gearData = inject(GearData);

  searchQuery = '';
  editingId: string | null = null;
  editingName = '';

  isTargetModalOpen = false;
  pendingSaved: SavedBuild | null = null;

  /** Saved builds filtered by the current search query. */
  get filtered(): SavedBuild[] {
    return this.library.search(this.searchQuery);
  }

  /** Begins inline renaming of an entry. */
  startRename(entry: SavedBuild) {
    this.editingId = entry.id;
    this.editingName = entry.name;
  }

  /** Commits an inline rename. */
  commitRename() {
    if (this.editingId) {
      this.library.rename(this.editingId, this.editingName.trim() || 'Untitled');
    }
    this.editingId = null;
    this.editingName = '';
  }

  /** Deletes a saved build after confirmation. */
  remove(id: string) {
    if (confirm('Delete this saved build?')) {
      this.library.remove(id);
    }
  }

  /** Opens the target chooser for inserting a saved build. */
  openTargetSelector(entry: SavedBuild) {
    this.pendingSaved = entry;
    this.isTargetModalOpen = true;
  }

  closeTargetModal() {
    this.isTargetModalOpen = false;
    this.pendingSaved = null;
  }

  /** Inserts a deep clone of the saved build into the chosen collection. */
  confirmTarget(collectionId: string) {
    if (!this.pendingSaved) return;
    const collection = this.workspace.findCollection(collectionId);
    if (!collection) return;

    const maxBuilds = collection.type === 'party' ? 20 : 12;
    if (collection.builds.length >= maxBuilds) return;

    const clone: PlayerBuild = JSON.parse(JSON.stringify(this.pendingSaved.build));
    clone.id = crypto.randomUUID();
    collection.builds.push(clone);
    collection.updatedAt = Date.now();
    this.workspace.touch();
    this.closeTargetModal();
  }

  /** The non-null gear items of a build, for icon previews. */
  gearIcons(build: PlayerBuild): GearItem[] {
    return [
      build.mainHand,
      build.head,
      build.chest,
      build.shoes,
      build.cape,
      build.food,
      build.potion,
    ].filter((g): g is GearItem => !!g);
  }

  /** Formats an epoch-millis value for display. */
  formatDate(value: number): string {
    return new Date(value).toLocaleString();
  }
}
