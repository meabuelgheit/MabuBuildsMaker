import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BuildCard } from '../../components/build-card/build-card';
import { BuildCollection, PlayerBuild } from '../../shared/models/item';
import { WorkspaceService, upgradeBuild, upgradeCollection } from '../../services/workspace';
import { UiStateService } from '../../services/ui-state';
import { PreferencesService } from '../../services/preferences';
import { LibraryService } from '../../services/library';
import { ToastService } from '../../services/toast';

/**
 * Workspace page: creates collections, edits their builds and handles
 * trash, target-destination, import and export.
 */
@Component({
  selector: 'app-workspace-page',
  standalone: true,
  imports: [FormsModule, BuildCard, TitleCasePipe],
  templateUrl: './workspace.html',
  styleUrls: ['./workspace.scss'],
})
export class WorkspacePage {
  workspace = inject(WorkspaceService);
  /** Shared zen-mode visibility flag drives hidden-view rendering. */
  uiState = inject(UiStateService);
  /** Layout preference: builds per grid column. */
  preferences = inject(PreferencesService);
  /** Saved-builds library, included in full backups. */
  library = inject(LibraryService);

  isTrashModalOpen = false;
  isTargetModalOpen = false;
  targetAction: 'duplicate' | 'restore' | null = null;
  pendingBuild: PlayerBuild | null = null;

  private toast = inject(ToastService);
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
    this.toast.show('Collection created.');
  }

  /** Archives a collection and reports where it went. */
  removeCollection(id: string) {
    this.workspace.archiveCollection(id);
    this.toast.show('Archived. Find it on the Groups page.');
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
        this.toast.show('Build moved to trash.');
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
    this.toast.show(
      this.targetAction === 'restore' ? 'Build restored.' : 'Build duplicated.',
    );
    this.closeTargetModal();
  }

  /** Resolves the effective builds-per-column for a collection (Auto fallback). */
  buildsPerColumnFor(collection: BuildCollection): number {
    return (
      this.preferences.buildsPerColumn ?? (collection.type === 'party' ? 10 : 6)
    );
  }

  /** Downloads a full backup (workspace + library + preferences) as JSON. */
  exportData() {
    if (
      this.workspace.collections.length === 0 &&
      this.library.savedBuilds.length === 0
    ) {
      alert('Nothing to export!');
      return;
    }
    const backup = {
      app: 'MabuBuildsMaker',
      version: 2,
      exportedAt: Date.now(),
      ...this.workspace.snapshot(),
      savedBuilds: this.library.snapshot(),
      preferences: this.preferences.snapshot(),
    };
    const dataStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mabu-builds-backup.json';
    a.click();
    window.URL.revokeObjectURL(url);
    this.toast.show('Backup exported.');
  }

  /** Imports a legacy array or a full backup object, upgrading on the way in. */
  importData(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);

        if (Array.isArray(parsed)) {
          // Legacy: a bare array of collections appended to the workspace.
          const upgradedCollections = parsed.map((c: any) =>
            upgradeCollection(c),
          );
          this.workspace.collections = [
            ...this.workspace.collections,
            ...upgradedCollections,
          ];
          this.workspace.touch();
          this.cdr.detectChanges();
          this.toast.show('Collections imported.');
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          Array.isArray(parsed.collections)
        ) {
          // Full backup: replace everything.
          if (!confirm('Replace all current data with this backup?')) {
            event.target.value = '';
            return;
          }
          this.workspace.replaceAll({
            collections: parsed.collections.map((c: any) => upgradeCollection(c)),
            trashedBuilds: Array.isArray(parsed.trashedBuilds)
              ? parsed.trashedBuilds.map((b: any) => upgradeBuild(b))
              : [],
            archivedCollections: Array.isArray(parsed.archivedCollections)
              ? parsed.archivedCollections.map((a: any) => ({
                  archivedAt: a?.archivedAt ?? Date.now(),
                  collection: upgradeCollection(a?.collection),
                }))
              : [],
          });
          this.library.replaceAll(
            Array.isArray(parsed.savedBuilds) ? parsed.savedBuilds : [],
          );
          this.preferences.replaceAll(parsed.preferences ?? {});
          this.cdr.detectChanges();
          this.toast.show('Backup imported.');
        } else {
          this.toast.show('Invalid file format.', 'error');
        }
      } catch (err) {
        console.error('Failed to parse file:', err);
        this.toast.show('Could not read the build file.', 'error');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  }
}
