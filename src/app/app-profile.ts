export type EventsProvider = 'tadl-feed' | 'wordpress-tribe';
export type NewsletterProvider = 'tadl-feed' | 'wordpress-posts';

export interface AppProfile {
  appName: string;
  appTitle: string;
  libraryName: string;
  websiteBase: string;
  privacyPolicyUrl: string;
  primaryColor: string;
  darkPrimaryColor: string;
  logo: {
    standard: string;
    standardDark: string;
    compact: string;
    compactDark: string;
  };
  systemShortName: string;
  aspenDiscoveryBase: string;
  aspenApiHost: string;
  aspenApiParam: string;
  locationsGroup: string;
  finesPaymentUrl: string;
  myMelcatAgency: string;
  suggestItemUrl: string;
  events: {
    provider: EventsProvider;
    url: string;
    venueFilter: boolean;
  };
  newsletter: {
    enabled: boolean;
    provider: NewsletterProvider;
    url: string;
  };
  features: {
    featured: boolean;
    webcams: boolean;
  };
  featuredCategoryIds: {
    books: string[];
    video: string[];
    music: string[];
  };
}

export const APP_PROFILE: AppProfile = {
  appName: 'TADL',
  appTitle: 'TADL Mobile',
  libraryName: 'Traverse Area District Library',
  websiteBase: 'https://www.tadl.org',
  privacyPolicyUrl: 'https://www.tadl.org/mobileapppolicy',
  primaryColor: '#49688E',
  darkPrimaryColor: '#8DB6FF',
  logo: {
    standard: 'assets/logo.png',
    standardDark: 'assets/logo-dark.png',
    compact: 'assets/logo-clock-only.png',
    compactDark: 'assets/logo-clock-only-dark.png',
  },
  systemShortName: 'TADL',
  aspenDiscoveryBase: 'https://discover.tadl.org',
  aspenApiHost: 'https://aspen.tools.tadl.org',
  aspenApiParam: 'tadl-prod',
  locationsGroup: 'tadl',
  finesPaymentUrl: 'https://pay.catalog.tadl.org/pay',
  myMelcatAgency: 'zv330',
  suggestItemUrl: 'https://www.tadl.org/suggestion',
  events: {
    provider: 'tadl-feed',
    url: 'https://feeds.tools.tadl.org/mobile_events.json',
    venueFilter: true,
  },
  newsletter: {
    enabled: true,
    provider: 'tadl-feed',
    url: 'https://feeds.tools.tadl.org/newsletter.json',
  },
  features: {
    featured: true,
    webcams: true,
  },
  featuredCategoryIds: {
    books: [
      'tadl_adult_fiction',
      'tadl_adult_nonfiction',
      'tadl_adult_audiobooks',
      'tadl_large_print',
    ],
    video: [
      'tadl_all_movie_genres',
      'tadl_hot_movies_tv',
      'tadl_tv',
      'tadl_movie_performing_arts',
    ],
    music: [
      'tadl_all_music_genres',
      'tadl_music_local',
      'tadl_music_pop_rock',
      'tadl_music_jazz',
    ],
  },
};
