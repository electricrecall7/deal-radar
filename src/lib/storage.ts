import AsyncStorage from '@react-native-async-storage/async-storage';

export type Stored<T> = { status: 'ok'; value: T } | { status: 'missing' } | { status: 'error' };

/** Tells "never saved" apart from "couldn't read", so a failed read isn't mistaken for empty data. */
export async function readJSON<T>(key: string): Promise<Stored<T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw === null ? { status: 'missing' } : { status: 'ok', value: JSON.parse(raw) as T };
  } catch (e) {
    console.warn(`Could not read ${key}`, e);
    return { status: 'error' };
  }
}

export async function loadJSON<T>(key: string): Promise<T | null> {
  const r = await readJSON<T>(key);
  return r.status === 'ok' ? r.value : null;
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Could not save ${key}`, e);
  }
}
