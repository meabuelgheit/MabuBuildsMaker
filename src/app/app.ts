import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BuildCard } from './components/build-card/build-card';
import { PlayerBuild } from './shared/models/item';

export interface BuildCollection {
  id: string;
  name: string;
  type: 'party' | 'group';
  builds: PlayerBuild[];
  isVisibleInViewMode: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, BuildCard],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
})
export class App {
  hideUI = false;
  collections: BuildCollection[] = [];

  trashedBuilds: PlayerBuild[] = [];
  isTrashModalOpen = false;

  isTargetModalOpen = false;
  targetAction: 'duplicate' | 'restore' | null = null;
  pendingBuild: PlayerBuild | null = null;

  constructor(private cdr: ChangeDetectorRef) {}

  addCollection(type: 'party' | 'group') {
    this.collections.push({
      id: crypto.randomUUID(),
      name: type === 'party' ? 'New Party' : 'New Group',
      type: type,
      builds: [],
      isVisibleInViewMode: true,
    });
  }

  removeCollection(id: string) {
    this.collections = this.collections.filter((c) => c.id !== id);
  }

  toggleVisibility(collectionId: string) {
    const collection = this.collections.find((c) => c.id === collectionId);
    if (collection) {
      collection.isVisibleInViewMode = !collection.isVisibleInViewMode;
    }
  }

  addBuild(collectionId: string) {
    const collection = this.collections.find((c) => c.id === collectionId);
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
      swaps: { weapon: [], head: [], chest: [], shoes: [], cape: [], food: [] },
      requiresApproval: false,
      minTier: '',
      tags: [],
    };
    collection.builds.push(newBuild);
  }

  deleteBuild(collectionId: string, buildId: string) {
    const collection = this.collections.find((c) => c.id === collectionId);
    if (collection) {
      const buildIndex = collection.builds.findIndex((b) => b.id === buildId);
      if (buildIndex > -1) {
        const [deleted] = collection.builds.splice(buildIndex, 1);
        this.trashedBuilds.push(deleted);
      }
    }
  }

  moveBuild(collectionId: string, buildId: string, direction: -1 | 1) {
    const collection = this.collections.find((c) => c.id === collectionId);
    if (!collection) return;

    const idx = collection.builds.findIndex((b) => b.id === buildId);
    if (idx < 0) return;

    const newIdx = idx + direction;
    if (newIdx >= 0 && newIdx < collection.builds.length) {
      const temp = collection.builds[idx];
      collection.builds[idx] = collection.builds[newIdx];
      collection.builds[newIdx] = temp;
    }
  }

  openTargetSelector(build: PlayerBuild, action: 'duplicate' | 'restore') {
    if (this.collections.length === 0) {
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

  confirmTarget(collectionId: string) {
    if (!this.pendingBuild || !this.targetAction) return;
    const targetCollection = this.collections.find((c) => c.id === collectionId);
    if (!targetCollection) return;

    const clonedBuild: PlayerBuild = JSON.parse(JSON.stringify(this.pendingBuild));
    clonedBuild.id = crypto.randomUUID();

    targetCollection.builds.push(clonedBuild);

    if (this.targetAction === 'restore') {
      this.trashedBuilds = this.trashedBuilds.filter((b) => b.id !== this.pendingBuild!.id);
    }

    this.closeTargetModal();
  }

  exportData() {
    if (this.collections.length === 0) {
      alert('No builds to export!');
      return;
    }
    const dataStr = JSON.stringify(this.collections, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mabu-builds.json';
    a.click();
    window.URL.revokeObjectURL(url);
  }

  importData(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedCollections = JSON.parse(e.target?.result as string);

        if (Array.isArray(importedCollections)) {
          const upgradedCollections = importedCollections.map((c: any) => ({
            ...c,
            isVisibleInViewMode: c.isVisibleInViewMode !== false,
            builds: c.builds.map((b: any) => ({
              ...b,
              tags: b.tags || [],
              swaps: {
                ...b.swaps,
                weapon: b.swaps?.weapon || b.swaps?.offHand || [],
              },
            })),
          }));

          this.collections = [...this.collections, ...upgradedCollections];
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
