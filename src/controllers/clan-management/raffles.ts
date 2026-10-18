import { Router, type Request, type Response } from 'express';
import { randomInt } from 'crypto';
import type { Types } from 'mongoose';
import Prize from '../../models/Prize';
import Raffle from '../../models/Raffle';
import Clan from '../../models/Clan';
import User from '../../models/User';
import { getClanForActiveChar } from '../../helpers/clanScope';
import { handleError, parse, badRequest, forbidden, notFound } from '../../helpers/http';
import { resolvePeriod, computeEligibility, clanRoster } from '../../helpers/raffle';
import { emitToUser } from '../../socket';
import { rafflePayload } from '../raffle';
import type { IRaffle } from '../../types';
import * as V from '../../validation/schemas';

// Sorteos del clan (líderes/oficiales del personaje activo). Los ganadores se eligen en el
// servidor, premio por premio y en orden: quien gana sale del bombo para los siguientes.
// El cliente solo anima la revelación.

const router = Router();

/** Clan del personaje activo si es líder/oficial; si no, 403. */
async function managedClan(req: Request, characterId: string | undefined): Promise<Types.ObjectId> {
  const clanId = await getClanForActiveChar(req.user!, characterId);
  if (!clanId) throw forbidden();
  return clanId;
}

router.get('/prizes', async (req: Request, res: Response): Promise<void> => {
  try {
    await managedClan(req, req.query.characterId as string | undefined);
    const prizes = await Prize.find({ active: true }).select('name description').sort({ name: 1 }).lean();
    res.status(200).json(prizes);
  } catch (err) { handleError(res, err); }
});

router.post('/eligible', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, criteria } = parse(V.raffleEligible, req.body);
    const clanId = await managedClan(req, characterId);
    const period = await resolvePeriod(clanId, criteria.range, criteria.cycleId);
    res.status(200).json(await computeEligibility(clanId, period, criteria.rules, criteria.includeStaff));
  } catch (err) { handleError(res, err); }
});

router.post('/draw', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, prizeIds, participantIds, criteria } = parse(V.raffleDraw, req.body);
    const clanId = await managedClan(req, characterId);

    const found = await Prize.find({ _id: { $in: prizeIds }, active: true }).select('name description').lean();
    const prizeById = new Map(found.map(p => [String(p._id), p]));
    const prizes = prizeIds.map(id => prizeById.get(id));
    if (prizes.some(p => !p)) throw badRequest('Algún premio no existe o ya no está disponible.');
    const period = await resolvePeriod(clanId, criteria.range, criteria.cycleId);

    // Los participantes los ajusta el líder, pero deben seguir siendo miembros del clan.
    const roster = new Map((await clanRoster(clanId)).map(m => [m._id, m]));
    const participants = [...new Set(participantIds)].map(id => roster.get(id));
    if (participants.some(p => !p)) throw badRequest('Algún participante ya no es miembro del clan. Vuelve a calcular la lista.');

    // Un premio por persona: cada ganador sale del bombo antes del siguiente premio.
    const pool = participants.map(p => p!);
    const draws = prizes.map(p => {
      const [winner] = pool.splice(randomInt(pool.length), 1);
      return {
        prize: p!._id,
        prizeName: p!.name,
        prizeDescription: p!.description ?? '',
        winner: { character: winner._id, name: winner.name },
      };
    });

    const raffle = await new Raffle({
      clan: clanId,
      criteria: {
        range: criteria.range, cycle: period.cycle?._id ?? null, since: period.since, until: period.until,
        rules: criteria.rules, includeStaff: criteria.includeStaff,
      },
      participants: participants.map(p => ({ character: p!._id, name: p!.name })),
      draws,
      drawnBy: req.user!._id,
      drawnByCharacter: characterId,
    }).save();

    // Aviso a los dueños de los personajes ganadores (si tienen cuenta). Si no están
    // conectados, lo verán al entrar (GET /raffle/my-wins).
    const owners = await User.find({ character: { $in: draws.map(d => d.winner.character) } }).select('_id character').lean();
    const ownerByChar = new Map<string, string>();
    for (const o of owners) for (const c of o.character ?? []) ownerByChar.set(String(c), String(o._id));
    if (ownerByChar.size) {
      const clan = await Clan.findById(clanId).select('name').lean();
      raffle.draws.forEach((d, i) => {
        const userId = ownerByChar.get(String(d.winner.character));
        if (userId) emitToUser(userId, 'raffle:won', rafflePayload(raffle as unknown as IRaffle, i, clan?.name ?? ''));
      });
    }

    res.status(201).json({
      raffleId: String(raffle._id),
      draws: raffle.draws.map(d => ({
        prizeName: d.prizeName,
        winner: { character: String(d.winner.character), name: d.winner.name },
        winnerHasUser: ownerByChar.has(String(d.winner.character)),
      })),
    });
  } catch (err) { handleError(res, err); }
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await managedClan(req, req.query.characterId as string | undefined);
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? '1',  10) || 1);
    const limit = Math.min(50, parseInt((req.query.limit as string) ?? '10', 10) || 10);
    const filter = { clan: clanId };
    const [total, docs] = await Promise.all([
      Raffle.countDocuments(filter),
      Raffle.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
        .select('criteria draws participants createdAt drawnByCharacter')
        .populate('drawnByCharacter', 'name').lean(),
    ]);
    const data = docs.map(({ participants, draws, ...d }) => ({
      ...d,
      draws: draws.map(x => ({ prizeName: x.prizeName, winner: x.winner })),
      participantsCount: participants.length,
    }));
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch (err) { handleError(res, err); }
});

/**
 * Elimina un sorteo del historial del clan (también sus avisos pendientes a los ganadores).
 * Solo fuera de producción: en producción el historial no se borra, para que nadie pueda
 * repetir un sorteo hasta obtener otro ganador.
 */
if (process.env.NODE_ENV !== 'production') {
  router.delete('/:raffleId', async (req: Request, res: Response): Promise<void> => {
    try {
      const clanId = await managedClan(req, req.query.characterId as string | undefined);
      const raffle = await Raffle.findOneAndDelete({ _id: req.params.raffleId, clan: clanId });
      if (!raffle) throw notFound('Sorteo no encontrado.');
      res.status(200).json({ message: 'Sorteo eliminado.' });
    } catch (err) { handleError(res, err); }
  });
}

export default router;
