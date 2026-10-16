import type { IUser } from '../types';
import { ownsCharacter } from './clanScope';

/**
 * Filtro de propiedad para recursos personales (Task, Crest, CompletedTask) que
 * pertenecen a un personaje o, en su defecto, directamente al usuario.
 *  - `character` entregado → debe ser del usuario, si no devuelve null (denegado).
 *  - sin `character`       → recursos del propio usuario.
 */
export function ownerFilter(user: IUser, character: unknown): Record<string, unknown> | null {
  if (character) {
    if (!ownsCharacter(user, String(character))) return null;
    return { character: String(character) };
  }
  return { user: user._id };
}

/** Filtro que matchea cualquier recurso del usuario (propio o de alguno de sus personajes). */
export function anyOwnedFilter(user: IUser): Record<string, unknown> {
  return { $or: [{ user: user._id }, { character: { $in: user.character ?? [] } }] };
}

/** Parsea una fecha; devuelve null si es inválida. */
export function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}
