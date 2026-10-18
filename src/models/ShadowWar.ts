import { Schema, model } from 'mongoose';
import type { IShadowWar, IMatch } from '../types';

const matchSchema = new Schema<IMatch>({
  group1: { character: { type: [Schema.Types.Mixed], default: [] } },
  group2: { character: { type: [Schema.Types.Mixed], default: [] } },
  result: { type: String },
});

// Exportado: la Vigilia de Espadas usa exactamente la misma estructura (models/VigilOfBlades).
export const shadowWarSchema = new Schema<IShadowWar>({
  clan:      { type: Schema.Types.ObjectId, ref: 'Clan', default: null },
  date:      { type: Date, required: true },
  result:    { type: String },
  enemyClan: { type: Schema.Types.ObjectId, ref: 'Clan' },
  battle: {
    exalted: [matchSchema],
    eminent: [matchSchema],
    famed:   [matchSchema],
    proud:   [matchSchema],
  },
  finalBattle: {
    exalted: [matchSchema],
    eminent: [matchSchema],
    famed:   [matchSchema],
    proud:   [matchSchema],
  },
  confirmed: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
  declined:  [{ type: Schema.Types.ObjectId, ref: 'Character' }],
  completed: { type: Boolean, default: false },
}, { timestamps: true });

shadowWarSchema.index({ clan: 1, date: -1 });
shadowWarSchema.index({ clan: 1, completed: 1, date: -1 });

export default model<IShadowWar>('ShadowWar', shadowWarSchema);
