import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  ArchivedCollection,
  BuildCollection,
  PlayerBuild,
} from '../shared/models/item';
import { StorageService } from './storage';

/** Shape persisted under the workspace key. */
interface WorkspaceState {
  collections: BuildCollection[];
  trashedBuilds: PlayerBuild[];
}

/** Upgrades a single build (legacy shapes) with safe defaults. */
export function upgradeBuild(raw: any): PlayerBuild {
  const build = { ...(raw ?? {}) };
  build.tags = build.tags || [];
  build.swaps = {
    ...build.swaps,
    weapon: build.swaps?.weapon || build.swaps?.offHand || [],
    head: build.swaps?.head || [],
    chest: build.swaps?.chest || [],
    shoes: build.swaps?.shoes || [],
    cape: build.swaps?.cape || [],
    food: build.swaps?.food || [],
    potion: build.swaps?.potion || [],
  };
  return build as PlayerBuild;
}

/** Upgrades a collection (legacy shapes) with safe defaults. */
export function upgradeCollection(raw: any): BuildCollection {
  const collection = { ...(raw ?? {}) };
  collection.isVisibleInViewMode = collection.isVisibleInViewMode !== false;
  collection.builds = Array.isArray(collection.builds)
    ? collection.builds.map((b: any) => upgradeBuild(b))
    : [];
  return collection as BuildCollection;
}

/**
 * Singleton store for workspace collections, trash and the permanent archive.
 * Browser-only persistence with a debounced save.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  collections: BuildCollection[] = [];
  trashedBuilds: PlayerBuild[] = [];
  archivedCollections: ArchivedCollection[] = [];

  private platformId = inject(PLATFORM_ID);
  private storage = inject(StorageService);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 400;

  constructor() {
    const state = this.storage.read<Partial<WorkspaceState>>(
      StorageService.WORKSPACE_KEY,
      {},
    );
    this.collections = Array.isArray(state.collections)
      ? state.collections.map((c) => upgradeCollection(c))
      : [];
    this.trashedBuilds = Array.isArray(state.trashedBuilds)
      ? state.trashedBuilds.map((b) => upgradeBuild(b))
      : [];

    const archived = this.storage.read<ArchivedCollection[]>(
      StorageService.ARCHIVE_KEY,
      [],
    );
    this.archivedCollections = Array.isArray(archived)
      ? archived.map((a) => ({
          archivedAt: a?.archivedAt ?? Date.now(),
          collection: upgradeCollection(a?.collection),
        }))
      : [];

    this.registerFlushListeners();
  }

  /** Debounced persistence used after every mutation. */
  touch(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, this.debounceMs);
  }

  /** Writes the workspace and archive slices; safe to call before any data. */
  persist(): void {
    this.storage.write(StorageService.WORKSPACE_KEY, {
      collections: this.collections,
      trashedBuilds: this.trashedBuilds,
    } satisfies WorkspaceState);
    this.storage.write(StorageService.ARCHIVE_KEY, this.archivedCollections);
  }

  /** Persists immediately, cancelling any pending debounce. */
  flushNow(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.persist();
  }

  /** Returns a serializable copy of the entire workspace state. */
  snapshot(): {
    collections: BuildCollection[];
    trashedBuilds: PlayerBuild[];
    archivedCollections: ArchivedCollection[];
  } {
    return {
      collections: this.collections,
      trashedBuilds: this.trashedBuilds,
      archivedCollections: this.archivedCollections,
    };
  }

  /** Replaces the entire workspace from a backup and persists. */
  replaceAll(state: {
    collections?: BuildCollection[];
    trashedBuilds?: PlayerBuild[];
    archivedCollections?: ArchivedCollection[];
  }): void {
    this.collections = Array.isArray(state?.collections) ? state.collections : [];
    this.trashedBuilds = Array.isArray(state?.trashedBuilds)
      ? state.trashedBuilds
      : [];
    this.archivedCollections = Array.isArray(state?.archivedCollections)
      ? state.archivedCollections
      : [];
    this.persist();
  }

  findCollection(id: string): BuildCollection | undefined {
    return this.collections.find((c) => c.id === id);
  }

  /** Moves a collection from the active list into the permanent archive. */
  archiveCollection(id: string): void {
    const index = this.collections.findIndex((c) => c.id === id);
    if (index < 0) return;
    const [collection] = this.collections.splice(index, 1);
    this.archivedCollections.push({ archivedAt: Date.now(), collection });
    this.persist();
  }

  /** Restores an archived collection back into the active list. */
  restoreCollection(archivedId: string): void {
    const index = this.archivedCollections.findIndex(
      (a) => a.collection.id === archivedId,
    );
    if (index < 0) return;
    const [entry] = this.archivedCollections.splice(index, 1);
    this.collections.push(entry.collection);
    this.persist();
  }

  /** Permanently removes an archived collection. */
  deleteArchivedForever(archivedId: string): void {
    this.archivedCollections = this.archivedCollections.filter(
      (a) => a.collection.id !== archivedId,
    );
    this.persist();
  }

  /** Permanently removes an active collection and any archived copy of it. */
  deleteCollectionForever(id: string): void {
    this.collections = this.collections.filter((c) => c.id !== id);
    this.archivedCollections = this.archivedCollections.filter(
      (a) => a.collection.id !== id,
    );
    this.persist();
  }

  /** Permanently removes a single build from the trash. */
  deleteTrashedForever(buildId: string): void {
    this.trashedBuilds = this.trashedBuilds.filter((b) => b.id !== buildId);
    this.persist();
  }

  /** Deep-clones a collection (active or archived) with fresh ids. */
  duplicateCollection(id: string): BuildCollection | null {
    const source =
      this.findCollection(id) ??
      this.archivedCollections.find((a) => a.collection.id === id)?.collection;
    if (!source) return null;
    const clone: BuildCollection = JSON.parse(JSON.stringify(source));
    clone.id = crypto.randomUUID();
    clone.name = `${source.name} (Copy)`;
    clone.updatedAt = Date.now();
    clone.builds = clone.builds.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
    }));
    this.collections.push(clone);
    this.persist();
    return clone;
  }

  /** Registers browser-only flush hooks for tab hide/unload. */
  private registerFlushListeners(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushNow();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flushNow());
    }
  }
}
