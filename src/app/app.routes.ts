import { Routes } from '@angular/router';
import { WorkspacePage } from './pages/workspace/workspace';
import { GroupsPage } from './pages/groups/groups';
import { BuildsPage } from './pages/builds/builds';
import { SettingsPage } from './pages/settings/settings';

export const routes: Routes = [
  { path: '', component: WorkspacePage, title: 'Workspace' },
  { path: 'groups', component: GroupsPage, title: 'Groups' },
  { path: 'builds', component: BuildsPage, title: 'Builds' },
  { path: 'settings', component: SettingsPage, title: 'Settings' },
  { path: '**', redirectTo: '' },
];
