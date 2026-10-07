import { Injectable, inject } from '@angular/core';
import { PlayerBuild, SavedBuild } from '../shared/models/item';
import { StorageService } from './storage';

/**
 * Singleton store for the permanent saved-builds library.
 * Saved builds are deep clones so later edits never mutate the saved copy.
 */
@Injectable({ providedIn: 'root' })
export class LibraryService {
  savedBuilds: SavedBuild[] = [];

  private storage = inject(StorageService);

  constructor() {
    const stored = this.storage.read<SavedBuild[]>(
      StorageService.LIBRARY_KEY,
      [],
    );
    this.savedBuilds = Array.isArray(stored) ? stored : [];
  }

  /** Deep-clones and stores a build, returning the created entry. */
  save(build: PlayerBuild): SavedBuild {
    const cloned: PlayerBuild = JSON.parse(JSON.stringify(build));
    cloned.id = crypto.randomUUID();
    const entry: SavedBuild = {
      id: crypto.randomUUID(),
      name: build.title,
      savedAt: Date.now(),
      build: cloned,
    };
    this.savedBuilds.push(entry);
    this.persist();
    return entry;
  }

  rename(id: string, name: string): void {
    const entry = this.get(id);
    if (!entry) return;
    entry.name = name;
    this.persist();
  }

  remove(id: string): void {
    this.savedBuilds = this.savedBuilds.filter((b) => b.id !== id);
    this.persist();
  }

  get(id: string): SavedBuild | undefined {
    return this.savedBuilds.find((b) => b.id === id);
  }

  /** Case-insensitive search over entry name and build title. */
  search(query: string): SavedBuild[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.savedBuilds;
    return this.savedBuilds.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.build.title.toLowerCase().includes(q),
    );
  }

  /** Returns a serializable copy of the saved-builds library. */
  snapshot(): SavedBuild[] {
    return this.savedBuilds;
  }

  /** Replaces the library from a backup and persists. */
  replaceAll(savedBuilds: SavedBuild[]): void {
    this.savedBuilds = Array.isArray(savedBuilds) ? savedBuilds : [];
    this.persist();
  }

  private persist(): void {
    this.storage.write(StorageService.LIBRARY_KEY, this.savedBuilds);
  }
}
