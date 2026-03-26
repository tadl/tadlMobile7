declare module '@ebarooni/capacitor-calendar' {
  export interface CalendarPermissionResult {
    result?: 'granted' | 'denied' | string;
  }

  export interface CreateEventWithPromptOptions {
    title: string;
    startDate: number;
    endDate: number;
    isAllDay?: boolean;
    description?: string;
    location?: string;
    url?: string;
  }

  export const CapacitorCalendar: {
    requestWriteOnlyCalendarAccess(): Promise<CalendarPermissionResult>;
    createEventWithPrompt(options: CreateEventWithPromptOptions): Promise<void>;
  };
}
