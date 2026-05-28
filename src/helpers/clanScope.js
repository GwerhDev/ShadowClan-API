const Clan      = require('../models/Clan');
const Character = require('../models/Character');

const isSystemAdmin = (user) =>
  user?.role === 'admin' || user?.role === 'super_admin';

/**
 * Returns the clan._id for the given character.
 * Tries Character.clan first (fast). If null, falls back to Clan model query
 * and auto-repairs Character.clan so future calls are fast.
 * Use for READ routes (any role: leader, officer, member).
 */
const getClanIdForCharacter = async (characterId) => {
  if (!characterId) return null;

  const char = await Character.findById(characterId).select('clan');
  if (char?.clan) return char.clan;

  // Fallback: character was added to clan without Character.clan being set
  const clan = await Clan.findOne({
    $or: [
      { leader:  String(characterId) },
      { officer: String(characterId) },
      { member:  String(characterId) },
    ],
  }).select('_id');

  if (clan?._id) {
    // Auto-repair so this path isn't needed again
    await Character.findByIdAndUpdate(characterId, { clan: clan._id });
    return clan._id;
  }

  return null;
};

/**
 * Returns the clan._id for write operations (leader/officer only).
 * Verifies characterId belongs to the user AND is leader/officer of their clan.
 * Returns null  → admin bypass.
 * Returns false → access denied.
 */
const getClanForActiveChar = async (user, characterId) => {
  if (isSystemAdmin(user)) return null;

  const charIds = (user?.character ?? []).map(String);
  if (!charIds.length) return false;

  const activeCharId = characterId && charIds.includes(String(characterId))
    ? String(characterId)
    : null;
  if (!activeCharId) return false;

  const clanId = await getClanIdForCharacter(activeCharId);
  if (!clanId) return false;

  // Verify leader/officer status in that clan
  const clan = await Clan.findOne({
    _id: clanId,
    $or: [{ leader: activeCharId }, { officer: activeCharId }],
  }).select('_id');

  return clan?._id ?? false;
};

module.exports = { isSystemAdmin, getClanForActiveChar, getClanIdForCharacter };
