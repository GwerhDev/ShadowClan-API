import { Router, type Request, type Response } from 'express';
import Raffle from '../models/Raffle';
import { requireAuth } from '../middlewares';
import { handleError, notFound, badRequest } from '../helpers/http';
import type { IRaffle } from '../types';

// Premios ganados por los personajes del usuario. El aviso llega por socket ('raffle:won');
// si el usuario no estaba conectado, el cliente lo pide al entrar y lo marca como visto.

const router = Router();
router.use(requireAuth);

/** Datos del aviso al ganador de un premio (socket y GET /my-wins). */
export function rafflePayload(raffle: IRaffle, drawIndex: number, clanName: string) {
  const d = raffle.draws[drawIndex];
  return {
    raffleId: String(raffle._id),
    drawIndex,
    characterId: String(d.winner.character),
    characterName: d.winner.name,
    clanName,
    prizeName: d.prizeName,
    prizeDescription: d.prizeDescription ?? '',
    createdAt: raffle.createdAt,
  };
}

router.get('/my-wins', async (req: Request, res: Response): Promise<void> => {
  try {
    const mine = new Set(req.user!.character.map(String));
    const raffles = await Raffle.find({
      draws: { $elemMatch: { 'winner.character': { $in: req.user!.character }, winnerAcknowledged: false } },
    }).sort({ createdAt: 1 }).populate<{ clan: { name?: string } | null }>('clan', 'name');

    const wins = raffles.flatMap(r => r.draws
      .map((d, i) => ({ d, i }))
      .filter(({ d }) => !d.winnerAcknowledged && mine.has(String(d.winner.character)))
      .map(({ i }) => rafflePayload(r as unknown as IRaffle, i, r.clan?.name ?? '')));
    res.status(200).json(wins);
  } catch (err) { handleError(res, err); }
});

router.post('/:id/ack', async (req: Request, res: Response): Promise<void> => {
  try {
    const index = Number(req.body?.drawIndex);
    if (!Number.isInteger(index) || index < 0) throw badRequest('drawIndex inválido.');
    const raffle = await Raffle.findOneAndUpdate(
      { _id: req.params.id, [`draws.${index}.winner.character`]: { $in: req.user!.character } },
      { $set: { [`draws.${index}.winnerAcknowledged`]: true } },
    );
    if (!raffle) throw notFound('Sorteo no encontrado.');
    res.status(200).json({ ok: true });
  } catch (err) { handleError(res, err); }
});

export default router;
