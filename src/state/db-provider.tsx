/**
 * Opens the on-device SQLite database once at app start, runs migrations, and seeds the
 * built-in algorithm definitions + default preferences. Exposes the handle via context so
 * stores/screens can read/write. No-ops on web (no expo-sqlite native module there).
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { openGooseDatabase, type GooseDatabase } from '../core/store/db';
import {
  seedBuiltInDefinitions,
  seedDefaultPreferences,
} from '../core/store/preferences-repository';
import { setDatabase } from './app-controller';

interface DatabaseContextValue {
  db: GooseDatabase | null;
  ready: boolean;
  error: string | null;
}

const DatabaseContext = createContext<DatabaseContextValue>({ db: null, ready: false, error: null });

/** Access the app database (null until ready / on web). */
export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseContextValue>({ db: null, ready: false, error: null });

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') {
      setState({ db: null, ready: true, error: null });
      return;
    }
    (async () => {
      try {
        const db = await openGooseDatabase();
        await seedBuiltInDefinitions(db);
        await seedDefaultPreferences(db);
        setDatabase(db);
        if (!cancelled) setState({ db, ready: true, error: null });
      } catch (error) {
        if (!cancelled) {
          setState({ db: null, ready: true, error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}
