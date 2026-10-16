import { z } from 'zod';

// Esquemas de validación de los payloads de escritura. Se usan con `parse()` de
// helpers/http (un error de validación responde 400 con el primer problema).

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'ID inválido');
export const dateYMD  = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)');
export const matchResult = z.enum(['pending', 'victory', 'defeat', 'draw']);

/** Un slot de formación: ID, personaje poblado ({ _id }) o vacío → se guarda siempre como ID|null. */
const slot = z
  .union([objectId, z.object({ _id: objectId }).passthrough(), z.null()])
  .transform(v => (v && typeof v === 'object' ? v._id : v));

const slotList = z.array(slot).max(10);

const match = z.object({
  group1: z.object({ character: slotList.default([]) }).default({ character: [] }),
  group2: z.object({ character: slotList.default([]) }).default({ character: [] }),
  result: z.string().max(20).optional(),
});
const matches = z.array(match).max(10);

export const battle = z.object({
  exalted: matches.default([]),
  eminent: matches.default([]),
  famed:   matches.default([]),
  proud:   matches.default([]),
});

export const towerRoster = z.object({
  group1: slotList.default([]),
  group2: slotList.default([]),
  group3: slotList.default([]),
});

/** Referencia opcional: ID, documento poblado ({ _id }), '' o null → ID|null (undefined = no tocar). */
const optionalNullableId = z.union([objectId, z.object({ _id: objectId }).passthrough(), z.literal(''), z.null()]).optional()
  .transform(v => (v === undefined ? undefined : v === '' || v === null ? null : typeof v === 'object' ? v._id : v));

// ── Shadow War / Accursed Tower ──────────────────────────────────────────────

export const shadowWarCreate = z.object({
  characterId: objectId.optional(),
  date:        dateYMD,
  enemyClan:   optionalNullableId,
});

export const shadowWarPatch = z.object({
  characterId: objectId.optional(),
  date:        z.string().optional(), // solo se aplica si viene como YYYY-MM-DD (compatibilidad)
  enemyClan:   optionalNullableId,
  result:      matchResult.optional(),
  battle:      battle.optional(),
  finalBattle: battle.nullable().optional(),
  completed:   z.boolean().optional(),
});

export const towerCreate = z.object({
  characterId: objectId.optional(),
  towerNumber: z.coerce.number().int().min(1).max(50),
  date:        z.string().min(1),
  enemyClan:   optionalNullableId,
});

export const towerPatch = z.object({
  characterId: objectId.optional(),
  towerNumber: z.coerce.number().int().min(1).max(50).optional(),
  date:        z.string().min(1).optional(),
  enemyClan:   optionalNullableId,
  roster:      towerRoster.optional(),
  finalRoster: towerRoster.nullable().optional(),
  completed:   z.boolean().optional(),
  result:      matchResult.optional(),
});

export const respond = z.object({
  characterId: objectId,
  action:      z.enum(['confirm', 'decline', 'pending']).optional(),
});

// ── Ciclos / temporadas ──────────────────────────────────────────────────────

export const cycleCreate = z.object({
  characterId:  objectId.optional(),
  startDate:    dateYMD,
  endDate:      dateYMD.optional().or(z.literal('').transform(() => undefined)),
  activityType: z.enum(['shadow', 'immortal']),
});

export const cyclePatch = z.object({
  characterId:  objectId.optional(),
  startDate:    dateYMD.optional(),
  endDate:      dateYMD.optional().or(z.literal('')),
  activityType: z.enum(['shadow', 'immortal']).optional(),
});

export const seasonCreate = z.object({
  characterId: objectId.optional(),
  startDate:   dateYMD,
  endDate:     dateYMD.optional().or(z.literal('').transform(() => undefined)),
});

export const seasonPatch = z.object({
  characterId: objectId.optional(),
  startDate:   dateYMD.optional(),
  endDate:     dateYMD.optional().or(z.literal('')),
});

// ── Clan ─────────────────────────────────────────────────────────────────────

const stat = z.coerce.number().min(0).max(1_000_000);

export const memberPatch = z.object({
  currentClass:     z.string().max(40).nullable().optional(),
  resonance:        stat.optional(),
  memberStatus:     z.string().max(40).optional(),
  armor:            stat.optional(),
  armorPenetration: stat.optional(),
  power:            stat.optional(),
  resistance:       stat.optional(),
});

export const clanCharacterCreate = z.object({
  name:         z.string().trim().min(1).max(40),
  resonance:    stat.optional(),
  currentClass: z.string().max(40).optional(),
});

export const invitationCreate = z.object({
  characterId:       objectId,
  role:              z.enum(['officer', 'member']).optional(),
  proposedClass:     z.string().max(40).nullable().optional(),
  proposedResonance: stat.nullable().optional(),
});

export const clanPostCreate = z.object({
  characterId: objectId,
  content:     z.string().max(1000).optional().default(''),
  source:      z.enum(['general', 'shadow_war', 'accursed_tower']).optional(),
  referenceId: objectId.nullable().optional(),
});

export const clanPostPatch = z.object({
  characterId: objectId.optional(),
  content:     z.string().max(1000),
});

export const clanRequestCreate = z.object({
  characterId: objectId,
  clanId:      objectId,
});
