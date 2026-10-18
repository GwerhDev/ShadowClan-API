// GET /active debe devolver la instancia no completada más antigua: la de hoy, aunque
// ya hayan pasado las 09:00 locales (las instancias se guardan a las 12:00Z) y aunque
// existan instancias futuras creadas por adelantado.
import express from 'express';
import request from 'supertest';

type Doc = { _id: string; clan: string; date: Date; completed?: boolean };

/** Modelo en memoria: aplica clan / completed / date.$gte y ordena por fecha. */
function fakeModel(docs: Doc[]) {
  const matches = (d: Doc, f: any) =>
    d.clan === f.clan &&
    (f.completed?.$ne !== true || d.completed !== true) &&
    (!f.date?.$gte || d.date >= f.date.$gte);
  const sorted = (arr: Doc[], spec: any) => [...arr].sort((a, b) => (spec?.date ?? 1) * (a.date.getTime() - b.date.getTime()));
  return {
    docs,
    findOne: (f: any) => ({ sort: (spec: any) => Promise.resolve(sorted(docs.filter(d => matches(d, f)), spec)[0] ?? null) }),
    find:    (f: any) => ({ sort: (spec: any) => Promise.resolve(sorted(docs.filter(d => matches(d, f)), spec)) }),
  };
}

const swModel    = fakeModel([]);
const towerModel = fakeModel([]);

jest.mock('../middlewares', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { _id: 'u1', role: 'user', character: ['c1'] }; next(); },
}));
jest.mock('../helpers/clanScope', () => ({
  resolveClanRead: async () => 'clanA',
  ownsCharacter: () => true,
  isCharacterInClan: async () => true,
}));
jest.mock('../helpers/activity', () => ({
  populateShadowWar: async (q: unknown) => q,
  populateTower: async (q: unknown) => q,
  applyResponse: () => undefined,
  SW_CATEGORIES: ['exalted', 'eminent', 'famed', 'proud'],
}));
jest.mock('../socket', () => ({ emitToClan: () => undefined }));
jest.mock('../models/AccursedTower', () => ({ __esModule: true, default: towerModel }));
// Completado real según la hora (Vigilia 20:30, Torre 20:00) sobre los modelos en memoria.
jest.mock('../helpers/autoComplete', () => {
  const real = jest.requireActual('../helpers/autoComplete');
  return {
    ...real,
    completeExpiredActivities: async () => {
      for (const d of swModel.docs)    if (real.isPastActivityDate(d.date, new Date(), 'vigil_of_blades')) d.completed = true;
      for (const d of towerModel.docs) if (real.isPastActivityDate(d.date, new Date(), 'accursed_tower')) d.completed = true;
    },
  };
});

import { createSWPublicRouter } from '../controllers/swLikePublicRouter';
import towerRouter from '../controllers/accursed-tower';
import type { SWKindConfig } from '../helpers/activityKinds';

const vigilCfg = {
  kind: 'vigil_of_blades',
  Model: swModel,
  notFound: 'not found',
  events: { updated: 'vigil:updated', assigned: 'vigil:assigned', idKey: 'vigilId' },
  postSource: 'vigil_of_blades',
} as unknown as SWKindConfig;

const app = express();
app.use('/vigil-of-blades', createSWPublicRouter(vigilCfg));
app.use('/accursed-tower', towerRouter);

const at = (iso: string) => new Date(iso);
/** Fija solo el reloj (Date); deja timers reales para supertest. */
const freezeAt = (iso: string) => jest.useFakeTimers({
  now: at(iso),
  doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
});

beforeEach(() => {
  // Vigilias del ciclo creadas por adelantado (domingos) + una vieja ya completada.
  swModel.docs.splice(0, swModel.docs.length,
    { _id: 'old',   clan: 'clanA', date: at('2026-10-11T12:00:00Z'), completed: true },
    { _id: 'today', clan: 'clanA', date: at('2026-10-18T12:00:00Z') },
    { _id: 'next',  clan: 'clanA', date: at('2026-10-25T12:00:00Z') },
    { _id: 'after', clan: 'clanA', date: at('2026-11-01T12:00:00Z') },
    { _id: 'other', clan: 'clanB', date: at('2026-10-17T12:00:00Z') },
  );
  towerModel.docs.splice(0, towerModel.docs.length,
    { _id: 't-today', clan: 'clanA', date: at('2026-10-18T12:00:00Z') },
    { _id: 't-next',  clan: 'clanA', date: at('2026-10-20T12:00:00Z') },
  );
});
afterEach(() => jest.useRealTimers());

describe('GET /active — instancia de hoy vs. futuras', () => {
  it('Vigilia: pasadas las 09:00 locales devuelve la de hoy, no la futura', async () => {
    freezeAt('2026-10-18T14:00:00Z'); // domingo 11:00 local (UTC-3), después de las 12:00Z
    const res = await request(app).get('/vigil-of-blades/active?characterId=c1');
    expect(res.status).toBe(200);
    expect(res.body._id).toBe('today');
  });

  it('Vigilia: después de su término (20:30 local) pasa a la siguiente', async () => {
    freezeAt('2026-10-18T23:45:00Z'); // domingo 20:45 local
    const res = await request(app).get('/vigil-of-blades/active?characterId=c1');
    expect(res.body._id).toBe('next');
  });

  it('Torre: la lista empieza por la de hoy (luego las futuras)', async () => {
    freezeAt('2026-10-18T14:00:00Z');
    const res = await request(app).get('/accursed-tower/active?characterId=c1');
    expect(res.status).toBe(200);
    expect(res.body.map((t: Doc) => t._id)).toEqual(['t-today', 't-next']);
  });
});
