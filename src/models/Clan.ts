import { Schema, model } from 'mongoose';
import type { IClan } from '../types';

const clanSchema = new Schema<IClan>({
  name:   { type: String, required: true },
  status: { type: String, default: 'unclaimed' },
  member: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
  officer:[{ type: Schema.Types.ObjectId, ref: 'Character' }],
  leader: { type: Schema.Types.ObjectId, ref: 'Character' },
  savedAccursedTowerAlignments: { type: Schema.Types.Mixed, default: null },
  savedShadowWarAlignments:     { type: Schema.Types.Mixed, default: null },
});

export default model<IClan>('Clan', clanSchema);
