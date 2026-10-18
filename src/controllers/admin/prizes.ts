import { Router, type Request, type Response } from 'express';
import Prize from '../../models/Prize';
import Raffle from '../../models/Raffle';
import { handleError, parse, notFound, conflict } from '../../helpers/http';
import * as V from '../../validation/schemas';

// Catálogo de premios para sorteos (Dashboard). Los líderes/oficiales los consumen desde
// /clan-management/raffles/prizes (solo activos).

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const prizes = await Prize.find().sort({ active: -1, name: 1 }).lean();
    const used = await Raffle.aggregate<{ _id: unknown; count: number }>([
      { $unwind: '$draws' },
      { $match: { 'draws.prize': { $in: prizes.map(p => p._id) } } },
      { $group: { _id: '$draws.prize', count: { $sum: 1 } } },
    ]);
    const usedBy = new Map(used.map(u => [String(u._id), u.count]));
    res.status(200).json(prizes.map(p => ({ ...p, rafflesCount: usedBy.get(String(p._id)) ?? 0 })));
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = parse(V.prizeCreate, req.body);
    const prize = await new Prize(data).save();
    res.status(201).json(prize);
  } catch (err) { handleError(res, err); }
});

router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const data = parse(V.prizePatch, req.body);
    const prize = await Prize.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!prize) throw notFound('Premio no encontrado.');
    res.status(200).json(prize);
  } catch (err) { handleError(res, err); }
});

router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    // Un premio ya sorteado queda en el historial: se desactiva en vez de borrarse.
    if (await Raffle.exists({ 'draws.prize': req.params.id })) {
      throw conflict('Este premio ya se usó en sorteos. Desactívalo en lugar de eliminarlo.');
    }
    const prize = await Prize.findByIdAndDelete(req.params.id);
    if (!prize) throw notFound('Premio no encontrado.');
    res.status(200).json({ message: 'Premio eliminado.' });
  } catch (err) { handleError(res, err); }
});

export default router;
