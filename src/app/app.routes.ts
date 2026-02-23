import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },

  {
    path: 'home',
    loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage),
  },
  {
    path: 'search',
    loadComponent: () => import('./pages/search/search.page').then(m => m.SearchPage),
  },
  {
    path: 'events',
    loadComponent: () => import('./pages/events/events.page').then(m => m.EventsPage),
  },
  {
    path: 'news',
    loadComponent: () => import('./pages/news/news.page').then(m => m.NewsPage),
  },
  {
    path: 'locations',
    loadComponent: () => import('./pages/locations/locations.page').then(m => m.LocationsPage),
  },
  {
    path: 'featured',
    loadComponent: () => import('./pages/featured/featured.page').then(m => m.FeaturedPage),
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about.page').then(m => m.AboutPage),
  },
  {
    path: 'holds',
    loadComponent: () => import('./pages/holds/holds.page').then(m => m.HoldsPage),
  },
  {
    path: 'checkouts',
    loadComponent: () => import('./pages/checkouts/checkouts.page').then(m => m.CheckoutsPage),
  },

  { path: '**', redirectTo: 'home' },
];
