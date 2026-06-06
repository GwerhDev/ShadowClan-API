import { Schema, model } from 'mongoose';
import type { IShadowWar, IMatch } from '../types';

const matchSchema = new Schema<IMatch>({
  group1: { character: { type: [Schema.Types.Mixed], default: [] } },
  group2: { character: { type: [Schema.Types.Mixed], default: [] } },
  result: { type: String },
});

const shadowWarSchema = new Schema<IShadowWar>({
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

export default model<IShadowWar>('ShadowWar', shadowWarSchema);
