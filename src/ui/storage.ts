// Sauvegardes locales (localStorage) et paramètres.
import { deserialize, SaveError, serialize } from '../sim/save';
import type { Game } from '../sim/world';

export type Slot = 'auto' | 'manual';
const KEY: Record<Slot, string> = { auto: 'lpf.save.auto', manual: 'lpf.save.manual' };
const SETTINGS_KEY = 'lpf.settings';

export interface Settings {
  showGrid: boolean;
  autosave: number; // secondes réelles, 0 = désactivée
  tutorial: boolean;
  panSpeed: number;
}
export const DEFAULT_SETTINGS: Settings = { showGrid: true, autosave: 45, tutorial: true, panSpeed: 1 };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* stockage indisponible */
  }
  return { ...DEFAULT_SETTINGS };
}
export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignoré */
  }
}

export interface SlotInfo {
  year: number;
  pop: number;
  savedAt: string;
}

export function slotInfo(slot: Slot): SlotInfo | null {
  try {
    const raw = localStorage.getItem(KEY[slot]);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { year: Math.floor(d.tick * 0.05 / 60) + 1, pop: Array.isArray(d.citizens) ? d.citizens.length : 0, savedAt: d.savedAt ?? '' };
  } catch {
    return { year: 0, pop: 0, savedAt: 'corrompue' };
  }
}

export function writeSlot(slot: Slot, g: Game): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(KEY[slot], serialize(g));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Impossible d’écrire la sauvegarde (stockage plein ou bloqué).' };
  }
}

export function readSlot(slot: Slot): { game?: Game; error?: string } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY[slot]);
  } catch {
    return { error: 'Le stockage local est inaccessible.' };
  }
  if (!raw) return { error: 'Aucune sauvegarde trouvée.' };
  return parseSave(raw);
}

export function parseSave(raw: string): { game?: Game; error?: string } {
  try {
    return { game: deserialize(raw) };
  } catch (e) {
    if (e instanceof SaveError) return { error: 'Sauvegarde corrompue ou invalide : ' + e.message };
    return { error: 'Sauvegarde illisible : ' + (e as Error).message };
  }
}

export function downloadSave(g: Game) {
  const blob = new Blob([serialize(g)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `premiers-foyers-annee${g.year}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}
