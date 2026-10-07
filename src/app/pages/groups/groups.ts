import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ArchivedCollection, BuildCollection } from '../../shared/models/item';
import { WorkspaceService } from '../../services/workspace';

/** Groups page: management of active and archived collections. */
@Component({
  selector: 'app-groups-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './groups.html',
  styleUrls: ['./groups.scss'],
})
export class GroupsPage {
  workspace = inject(WorkspaceService);
  private router = inject(Router);

  /** Navigates to the workspace, restoring archived entries first. */
  open(collection: BuildCollection) {
    if (this.isArchived(collection.id)) {
      this.workspace.restoreCollection(collection.id);
    }
    this.router.navigate(['/']);
  }

  /** Duplicates an active collection. */
  duplicate(id: string) {
    this.workspace.duplicateCollection(id);
  }

  /** Restores an archived collection into the active list. */
  restore(archivedId: string) {
    this.workspace.restoreCollection(archivedId);
  }

  /** Permanently deletes an archived collection after confirmation. */
  deleteForever(archivedId: string) {
    if (confirm('Delete this archived collection forever?')) {
      this.workspace.deleteArchivedForever(archivedId);
    }
  }

  /** True when the collection id belongs to the archive. */
  isArchived(id: string): boolean {
    return this.workspace.archivedCollections.some((a) => a.collection.id === id);
  }

  /** Build titles for a collection, for card previews. */
  titles(collection: BuildCollection): string[] {
    return collection.builds.map((b) => b.title);
  }

  /** Formats an epoch-millis value, or a dash when absent. */
  formatDate(value?: number): string {
    return value ? new Date(value).toLocaleString() : '—';
  }

  /** Archived entries (used by the template). */
  get archived(): ArchivedCollection[] {
    return this.workspace.archivedCollections;
  }
}
