import { Router, type Request, type Response } from 'express';
import Season from '../../models/Season';
import { message } from '../../messages';
import { isSystemAdmin, resolveClanRead, getClanForActiveChar } from '../../helpers/clanScope';
import { handleError, parse } from '../../helpers/http';
import * as V from '../../validation/schemas';

const router = Router();


function parseDayStart(d: string): Date { return new Date(d + 'T00:00:00.000Z'); }
function parseDayEnd(d: string): Date { return new Date(d + 'T23:59:59.999Z'); }

// ── Seasons (períodos de Torre Maldita — sin lógica propia todavía) ─────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const clanId = await resolveClanRead(req.user!, req.query.characterId as string);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    const page  = parseInt((req.query.page  as string) ?? '1',  10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '10', 10) || 10;
    const filter: Record<string, unknown> = clanId ? { clan: clanId } : {};
    const total = await Season.countDocuments(filter);
    const data  = await Season.find(filter).sort({ startDate: -1 }).skip((page - 1) * limit).limit(limit);
    res.status(200).json({ total, page, limit, pages: Math.ceil(total / limit), data });
  } catch (err) { handleError(res, err); }
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, startDate, endDate } = parse(V.seasonCreate, req.body);
    const clanId = await getClanForActiveChar(req.user!, characterId);
    if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    if (!clanId) { res.status(400).json({ message: 'characterId requerido.' }); return; }
    if (!startDate) { res.status(400).json({ message: 'startDate es requerido.' }); return; }

    const season = await new Season({
      clan: clanId,
      startDate: parseDayStart(startDate),
      endDate: endDate ? parseDayEnd(endDate) : undefined,
      createdBy: req.user!._id,
    }).save();
    res.status(201).json(season);
  } catch (err) { handleError(res, err); }
});

router.patch('/:seasonId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { characterId, startDate, endDate } = parse(V.seasonPatch, req.body);
    const season = await Season.findById(req.params.seasonId);
    if (!season) { res.status(404).json({ message: 'Season not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, characterId);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(season.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }

    if (startDate !== undefined) season.startDate = parseDayStart(startDate);
    if (endDate !== undefined && endDate) season.endDate = parseDayEnd(endDate);
    await season.save();
    res.status(200).json(season);
  } catch (err) { handleError(res, err); }
});

router.delete('/:seasonId', async (req: Request, res: Response): Promise<void> => {
  try {
    const season = await Season.findById(req.params.seasonId);
    if (!season) { res.status(404).json({ message: 'Season not found' }); return; }
    if (!isSystemAdmin(req.user!)) {
      const clanId = await getClanForActiveChar(req.user!, req.query.characterId as string);
      if (clanId === false) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
      if (clanId && String(season.clan) !== String(clanId)) { res.status(403).json({ message: message.admin.permissionDenied }); return; }
    }
    await Season.findByIdAndDelete(req.params.seasonId);
    res.status(200).json({ message: 'Season deleted' });
  } catch (err) { handleError(res, err); }
});

export default router;
