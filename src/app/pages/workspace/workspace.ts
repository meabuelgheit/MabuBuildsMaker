import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BuildCard } from '../../components/build-card/build-card';
import { PlayerBuild } from '../../shared/models/item';
import { WorkspaceService, upgradeCollection } from '../../services/workspace';
import { UiStateService } from '../../services/ui-state';

/**
 * Workspace page: creates collections, edits their builds and handles
 * trash, target-destination, import and export.
 */
@Component({
  selector: 'app-workspace-page',
  standalone: true,
  imports: [CommonModule, FormsModule, BuildCard],
  templateUrl: './workspace.html',
  styleUrls: ['./workspace.scss'],
})
export class WorkspacePage {
  workspace = inject(WorkspaceService);
  /** Shared zen-mode visibility flag drives hidden-view rendering. */
  uiState = inject(UiStateService);

  isTrashModalOpen = false;
  isTargetModalOpen = false;
  targetAction: 'duplicate' | 'restore' | null = null;
  pendingBuild: PlayerBuild | null = null;
  archivedConfirmation = false;

  private cdr = inject(ChangeDetectorRef);

  /** Creates a new party/group collection and starts persistence. */
  addCollection(type: 'party' | 'group') {
    this.workspace.collections.push({
      id: crypto.randomUUID(),
      name: type === 'party' ? 'New Party' : 'New Group',
      type: type,
      builds: [],
      isVisibleInViewMode: true,
      updatedAt: Date.now(),
    });
    this.workspace.touch();
  }

  /** Archives a collection and briefly confirms where it went. */
  removeCollection(id: string) {
    this.workspace.archiveCollection(id);
    this.archivedConfirmation = true;
    setTimeout(() => {
      this.archivedConfirmation = false;
      this.cdr.markForCheck();
    }, 3000);
  }

  /** Flips a collection's view-mode visibility and persists. */
  toggleVisibility(collectionId: string) {
    const collection = this.workspace.findCollection(collectionId);
    if (collection) {
      collection.isVisibleInViewMode = !collection.isVisibleInViewMode;
      collection.updatedAt = Date.now();
      this.workspace.touch();
    }
  }

  /** Appends an empty build, respecting the party/group caps. */
  addBuild(collectionId: string) {
    const collection = this.workspace.findCollection(collectionId);
    if (!collection) return;

    const maxBuilds = collection.type === 'party' ? 20 : 12;
    if (collection.builds.length >= maxBuilds) return;

    const newBuild: PlayerBuild = {
      id: crypto.randomUUID(),
      title: 'New Build',
      mainHand: null,
      head: null,
      chest: null,
      shoes: null,
      cape: null,
      food: null,
      potion: null,
      swaps: {
        weapon: [],
        head: [],
        chest: [],
        shoes: [],
        cape: [],
        food: [],
        potion: [],
      },
      requiresApproval: false,
      minTier: '',
      tags: [],
    };
    collection.builds.push(newBuild);
    collection.updatedAt = Date.now();
    this.workspace.touch();
  }

  /** Moves a build to the trash and persists. */
  deleteBuild(collectionId: string, buildId: string) {
    const collection = this.workspace.findCollection(collectionId);
    if (collection) {
      const buildIndex = collection.builds.findIndex((b) => b.id === buildId);
      if (buildIndex > -1) {
        const [deleted] = collection.builds.splice(buildIndex, 1);
        this.workspace.trashedBuilds.push(deleted);
        collection.updatedAt = Date.now();
        this.workspace.touch();
      }
    }
  }

  /** Reorders a build within its collection and persists. */
  moveBuild(collectionId: string, buildId: string, direction: -1 | 1) {
    const collection = this.workspace.findCollection(collectionId);
    if (!collection) return;

    const idx = collection.builds.findIndex((b) => b.id === buildId);
    if (idx < 0) return;

    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < collection.builds.length) {
      const temp = collection.builds[idx];
      collection.builds[idx] = collection.builds[newIdx];
      collection.builds[newIdx] = temp;
      collection.updatedAt = Date.now();
      this.workspace.touch();
    }
  }

  openTargetSelector(build: PlayerBuild, action: 'duplicate' | 'restore') {
    if (this.workspace.collections.length === 0) {
      alert('You need at least one group or party to do this.');
      return;
    }
    this.pendingBuild = build;
    this.targetAction = action;
    this.isTargetModalOpen = true;
  }

  closeTargetModal() {
    this.isTargetModalOpen = false;
    this.pendingBuild = null;
    this.targetAction = null;
  }

  /** Duplicates or restores a build into the chosen collection. */
  confirmTarget(collectionId: string) {
    if (!this.pendingBuild || !this.targetAction) return;
    const targetCollection = this.workspace.findCollection(collectionId);
    if (!targetCollection) return;

    const clonedBuild: PlayerBuild = JSON.parse(JSON.stringify(this.pendingBuild));
    clonedBuild.id = crypto.randomUUID();

    targetCollection.builds.push(clonedBuild);
    targetCollection.updatedAt = Date.now();

    if (this.targetAction === 'restore') {
      this.workspace.trashedBuilds = this.workspace.trashedBuilds.filter(
        (b) => b.id !== this.pendingBuild!.id,
      );
    }

    this.workspace.touch();
    this.closeTargetModal();
  }

  /** Downloads the current collections as a JSON file. */
  exportData() {
    if (this.workspace.collections.length === 0) {
      alert('No builds to export!');
      return;
    }
    const dataStr = JSON.stringify(this.workspace.collections, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mabu-builds.json';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  /** Imports collections from JSON, upgrading legacy shapes. */
  importData(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedCollections = JSON.parse(e.target?.result as string);

        if (Array.isArray(importedCollections)) {
          const upgradedCollections = importedCollections.map((c: any) =>
            upgradeCollection(c),
          );

          this.workspace.collections = [
            ...this.workspace.collections,
            ...upgradedCollections,
          ];
          this.workspace.touch();
          this.cdr.detectChanges();
        } else {
          alert('Invalid file format.');
        }
      } catch (err) {
        console.error('Failed to parse file:', err);
        alert('Could not read the build file.');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  }
}
