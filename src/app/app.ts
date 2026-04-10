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
    };
    collection.builds.push(newBuild);
  }

  deleteBuild(collectionId: string, buildId: string) {
    const collection = this.collections.find((c) => c.id === collectionId);
    if (collection) {
      collection.builds = collection.builds.filter((b) => b.id !== buildId);
    }
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
