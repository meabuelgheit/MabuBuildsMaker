import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Thin, browser-guarded wrapper over localStorage.
 * On the server (prerender) every read returns the fallback and writes are no-ops.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private platformId = inject(PLATFORM_ID);
  private hasWarned = false;

  /** Namespaced localStorage key for the workspace collections + trash. */
  static readonly WORKSPACE_KEY = 'mabu.buildsMaker.workspace.v1';
  /** Namespaced localStorage key for the saved-builds library. */
  static readonly LIBRARY_KEY = 'mabu.buildsMaker.library.v1';
  /** Namespaced localStorage key for user preferences (tiers + background). */
  static readonly PREFERENCES_KEY = 'mabu.buildsMaker.preferences.v1';
  /** Namespaced localStorage key for the permanent archive. */
  static readonly ARCHIVE_KEY = 'mabu.buildsMaker.archive.v1';

  /** Reads and parses a key, returning the fallback on missing/invalid data. */
  read<T>(key: string, fallback: T): T {
    if (!isPlatformBrowser(this.platformId)) return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.warnOnce('read', key, err);
      return fallback;
    }
  }

  /** Serializes and writes a value, returning whether the write succeeded. */
  write(key: string, value: unknown): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      this.warnOnce('write', key, err);
      return false;
    }
  }

  /** Emits a single warning the first time persistence fails. */
  private warnOnce(action: string, key: string, err: unknown): void {
    if (this.hasWarned) return;
    this.hasWarned = true;
    console.warn(`[StorageService] Failed to ${action} "${key}".`, err);
  }
}
