import type { LocalDate } from '../logic/dates';

export interface Streak {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  frequency: 'daily';
  start_date: LocalDate;
  checkin_enabled: boolean;
  checkin_time: string | null; // 'HH:MM:SS'
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Completion {
  streak_id: string;
  completed_date: LocalDate;
  source: 'manual' | 'notification';
  created_at: string;
}

export interface NewStreakInput {
  name: string;
  description: string | null;
  start_date: LocalDate;
  checkin_enabled: boolean;
  checkin_time: string | null; // 'HH:MM'
}

export type StreakDetailsPatch = Partial<Pick<Streak, 'name' | 'description'>>;
export type CheckinPatch = Pick<Streak, 'checkin_enabled' | 'checkin_time'>;
