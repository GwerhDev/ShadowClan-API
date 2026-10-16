/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Types } from 'mongoose';
import ShadowWar from '../models/ShadowWar';
import AccursedTower from '../models/AccursedTower';
import Character from '../models/Character';

// Helpers compartidos por los controladores de Shadow War y Accursed Tower
// (públicos y de clan-management): poblar formaciones y registrar respuestas.

export const SW_CATEGORIES = ['exalted', 'eminent', 'famed', 'proud'] as const;
const TOWER_GROUPS = ['group1', 'group2', 'group3'] as const;
const CHAR_FIELDS = 'name currentClass score clan';

const toId = (v: any): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return String(v._id ?? v);
  return String(v);
};

async function charMapFor(ids: Set<string>) {
  const chars = ids.size ? await Character.find({ _id: { $in: [...ids] } }).select(CHAR_FIELDS).lean() : [];
  return new Map(chars.map(c => [String((c as any)._id), c]));
}

/** Reemplaza los IDs de personaje de `battle`/`finalBattle` por el documento (una sola consulta). */
export async function populateSWBattle(sws: any[]): Promise<any[]> {
  const ids = new Set<string>();
  for (const sw of sws) {
    for (const battle of ['battle', 'finalBattle'] as const) {
      for (const cat of SW_CATEGORIES) {
        for (const match of (sw[battle]?.[cat] ?? [])) {
          for (const id of [...(match.group1?.character ?? []), ...(match.group2?.character ?? [])]) {
            const s = toId(id); if (s) ids.add(s);
          }
        }
      }
    }
  }
  const charMap = await charMapFor(ids);
  const mapGroup = (g: any[]) => (g ?? []).map((id: any) => { const s = toId(id); return s ? (charMap.get(s) ?? null) : null; });
  return sws.map(sw => {
    const obj = sw.toObject ? sw.toObject() : { ...sw };
    for (const battle of ['battle', 'finalBattle'] as const) {
      if (!obj[battle]) continue;
      for (const cat of SW_CATEGORIES) {
        if (!obj[battle][cat]) continue;
        obj[battle][cat] = (obj[battle][cat] as any[]).map((match: any) => ({
          ...match,
          group1: { ...match.group1, character: mapGroup(match.group1?.character) },
          group2: { ...match.group2, character: mapGroup(match.group2?.character) },
        }));
      }
    }
    return obj;
  });
}

/** Ejecuta la query de ShadowWar con enemyClan/confirmed/declined poblados y formaciones resueltas. */
export async function populateShadowWar(q: ReturnType<typeof ShadowWar.findById> | ReturnType<typeof ShadowWar.findOne>): Promise<any> {
  const result = await (q as ReturnType<typeof ShadowWar.findById>).populate('enemyClan').populate('confirmed').populate('declined').lean();
  if (!result) return null;
  if (Array.isArray(result)) return populateSWBattle(result);
  const [populated] = await populateSWBattle([result]);
  return populated;
}

/** Reemplaza los IDs de `roster`/`finalRoster` por el documento del personaje. */
export async function populateRosters(towers: any[]): Promise<any[]> {
  const ids = new Set<string>();
  for (const t of towers) {
    for (const grp of TOWER_GROUPS) {
      for (const id of [...(t.roster?.[grp] ?? []), ...(t.finalRoster?.[grp] ?? [])]) {
        const s = toId(id); if (s) ids.add(s);
      }
    }
  }
  const charMap = await charMapFor(ids);
  const mapGroup = (g: any[]) => (g ?? []).map((id: any) => { const s = toId(id); return s ? (charMap.get(s) ?? null) : null; });
  const mapRoster = (r: any) => ({ group1: mapGroup(r.group1), group2: mapGroup(r.group2), group3: mapGroup(r.group3) });
  return towers.map(t => {
    const obj = t.toObject ? t.toObject() : { ...t };
    if (obj.roster)      obj.roster      = mapRoster(obj.roster);
    if (obj.finalRoster) obj.finalRoster = mapRoster(obj.finalRoster);
    return obj;
  });
}

/** Ejecuta la query de AccursedTower (uno o varios) con enemyClan poblado y rosters resueltos. */
export async function populateTower(q: unknown): Promise<any> {
  const result = await (q as ReturnType<typeof AccursedTower.findById>).populate('enemyClan').lean();
  if (!result) return null;
  if (Array.isArray(result)) return populateRosters(result);
  const [populated] = await populateRosters([result]);
  return populated;
}

export type RespondAction = 'confirm' | 'decline' | 'pending';

/**
 * Registra la respuesta de un personaje a una actividad (Shadow War o torre):
 * confirm → confirmed, decline → declined, cualquier otra → quita de ambas listas.
 * Muta el documento; el llamador hace `save()`.
 */
export function applyResponse(
  doc: { confirmed: Types.Array<any> | any[]; declined: Types.Array<any> | any[] },
  characterId: string,
  action: string | undefined,
): void {
  const act = action ?? 'confirm';
  const without = (list: any[]) => list.filter(id => String(id) !== characterId);
  doc.confirmed = without(doc.confirmed as any[]) as typeof doc.confirmed;
  doc.declined  = without(doc.declined as any[]) as typeof doc.declined;
  if (act === 'confirm') (doc.confirmed as any[]).push(characterId);
  else if (act === 'decline') (doc.declined as any[]).push(characterId);
}
