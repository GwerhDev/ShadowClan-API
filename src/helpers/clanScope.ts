import { Types } from 'mongoose';
import Clan from '../models/Clan';
import Character from '../models/Character';
import type { IUser, UserRole } from '../types';

/**
 * Resultado de resolver el clan de un personaje:
 *  - ObjectId → clan resuelto (filtrar por él)
 *  - null     → admin de sistema sin characterId (sin filtro, caso Dashboard)
 *  - false    → acceso denegado, o el personaje no tiene clan
 */
export type ClanScope = Types.ObjectId | null | false;

type Id = Types.ObjectId | string | null | undefined;

export function isSystemAdmin(user: IUser): boolean {
  return user.role === 'admin' || user.role === 'super_admin';
}

export function sameId(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return String((a as { _id?: unknown })?._id ?? a) === String((b as { _id?: unknown })?._id ?? b);
}

/** El personaje pertenece a la cuenta del usuario. */
export function ownsCharacter(user: IUser, characterId: Id): boolean {
  if (!characterId) return false;
  return (user.character ?? []).some(c => sameId(c, characterId));
}

/**
 * Returns the clan._id for the given character.
 * Tries Character.clan first; falls back to Clan model query and auto-repairs.
 */
export async function getClanIdForCharacter(
  characterId: string | Types.ObjectId,
): Promise<Types.ObjectId | null> {
  if (!Types.ObjectId.isValid(String(characterId))) return null;
  const char = await Character.findById(characterId).select('clan');
  if (char?.clan) return char.clan as Types.ObjectId;

  const clan = await Clan.findOne({
    $or: [
      { leader:  characterId },
      { officer: characterId },
      { member:  characterId },
    ],
  }).select('_id');

  if (clan?._id) {
    await Character.findByIdAndUpdate(characterId, { clan: clan._id });
    return clan._id as Types.ObjectId;
  }

  return null;
}

/**
 * READ routes (any role). El personaje debe ser del usuario (salvo admins).
 * Si se entrega characterId y el personaje no tiene clan → false (nunca sin filtro).
 */
export async function resolveClanRead(user: IUser, characterId: string | undefined): Promise<ClanScope> {
  if (isSystemAdmin(user)) {
    if (!characterId) return null;
    return (await getClanIdForCharacter(characterId)) ?? false;
  }
  if (!ownsCharacter(user, characterId)) return false;
  return (await getClanIdForCharacter(characterId!)) ?? false;
}

/**
 * WRITE routes (leader/officer only). Verifica que el personaje activo sea
 * líder u oficial de su clan. Admins: null sin characterId (bypass).
 */
export async function getClanForActiveChar(
  user: IUser,
  characterId: string | undefined,
): Promise<ClanScope> {
  if (isSystemAdmin(user)) {
    if (!characterId) return null;
    return (await getClanIdForCharacter(characterId)) ?? false;
  }

  if (!ownsCharacter(user, characterId)) return false;

  const clanId = await getClanIdForCharacter(characterId!);
  if (!clanId) return false;

  const clan = await Clan.findOne({
    _id:  clanId,
    $or:  [{ leader: characterId }, { officer: characterId }],
  }).select('_id');

  return (clan?._id as Types.ObjectId | undefined) ?? false;
}

/** Alias semántico de getClanForActiveChar. */
export const resolveClanWrite = getClanForActiveChar;

/**
 * ¿Puede el usuario operar sobre un documento que pertenece a `docClan`?
 * Admins de sistema siempre pueden. El resto debe resolver el mismo clan
 * a partir de su personaje activo.
 */
export async function canAccessClanDoc(
  user: IUser,
  docClan: unknown,
  characterId: string | undefined,
  mode: 'read' | 'write',
): Promise<boolean> {
  if (isSystemAdmin(user)) return true;
  const clanId = mode === 'read'
    ? await resolveClanRead(user, characterId)
    : await getClanForActiveChar(user, characterId);
  return !!clanId && sameId(clanId, docClan);
}

/** El personaje (cualquiera, no necesariamente del usuario) pertenece al clan. */
export async function isCharacterInClan(characterId: Id, clanId: unknown): Promise<boolean> {
  if (!characterId || !clanId) return false;
  const charClan = await getClanIdForCharacter(characterId);
  return sameId(charClan, clanId);
}

/** El personaje es líder u oficial del clan. */
export async function isLeaderOrOfficerOf(characterId: Id, clanId: unknown): Promise<boolean> {
  if (!characterId || !clanId) return false;
  const clan = await Clan.findOne({
    _id: clanId,
    $or: [{ leader: characterId }, { officer: characterId }],
  }).select('_id');
  return !!clan;
}

/** Escapa un string para usarlo literal dentro de un RegExp. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const MANAGEMENT_ROLES: UserRole[] = ['leader', 'officer', 'admin', 'super_admin'];
