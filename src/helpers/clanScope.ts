import { Types } from 'mongoose';
import Clan from '../models/Clan';
import Character from '../models/Character';
import type { IUser, UserRole } from '../types';

export function isSystemAdmin(user: IUser): boolean {
  return user.role === 'admin' || user.role === 'super_admin';
}

/**
 * Returns the clan._id for the given character.
 * Tries Character.clan first; falls back to Clan model query and auto-repairs.
 * Use for READ routes (any role).
 */
export async function getClanIdForCharacter(
  characterId: string | Types.ObjectId,
): Promise<Types.ObjectId | null> {
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
 * Returns the clan._id for write operations (leader/officer only).
 * Returns null  → admin bypass.
 * Returns false → access denied.
 */
export async function getClanForActiveChar(
  user: IUser,
  characterId: string | undefined,
): Promise<Types.ObjectId | null | false> {
  if (isSystemAdmin(user)) {
    if (!characterId) return null;
    const char = await Character.findById(characterId).select('clan');
    return (char?.clan as Types.ObjectId | undefined) ?? null;
  }

  const charIds = user.character.map(String);
  if (!characterId || !charIds.includes(String(characterId))) return false;

  const clanId = await getClanIdForCharacter(characterId);
  if (!clanId) return false;

  const clan = await Clan.findOne({
    _id:  clanId,
    $or:  [{ leader: characterId }, { officer: characterId }],
  }).select('_id');

  return (clan?._id as Types.ObjectId | undefined) ?? false;
}

export const MANAGEMENT_ROLES: UserRole[] = ['leader', 'officer', 'admin', 'super_admin'];
