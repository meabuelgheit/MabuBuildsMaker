import { Component, inject } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ArchivedCollection, BuildCollection } from '../../shared/models/item';
import { WorkspaceService } from '../../services/workspace';
import { ToastService } from '../../services/toast';

/** Groups page: management of active and archived collections. */
@Component({
  selector: 'app-groups-page',
  standalone: true,
  imports: [TitleCasePipe],
  templateUrl: './groups.html',
  styleUrls: ['./groups.scss'],
})
export class GroupsPage {
  workspace = inject(WorkspaceService);
  private router = inject(Router);
  private toast = inject(ToastService);

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
    this.toast.show('Collection duplicated.');
  }

  /** Restores an archived collection into the active list. */
  restore(archivedId: string) {
    this.workspace.restoreCollection(archivedId);
    this.toast.show('Collection restored.');
  }

  /** Permanently deletes an archived collection after confirmation. */
  deleteForever(archivedId: string) {
    if (confirm('Delete this archived collection forever?')) {
      this.workspace.deleteArchivedForever(archivedId);
      this.toast.show('Deleted forever.', 'info');
    }
  }

  /** Archives an active collection into the Archived section. */
  archive(id: string) {
    this.workspace.archiveCollection(id);
    this.toast.show('Archived. Find it on the Groups page.');
  }

  /** Permanently deletes an active collection after confirmation. */
  deleteActiveForever(id: string) {
    if (confirm('Delete this group forever? This cannot be undone.')) {
      this.workspace.deleteCollectionForever(id);
      this.toast.show('Deleted forever.', 'info');
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
