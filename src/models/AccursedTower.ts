import { Schema, model } from 'mongoose';
import type { IAccursedTower } from '../types';

const accursedTowerSchema = new Schema<IAccursedTower>({
  clan:        { type: Schema.Types.ObjectId, ref: 'Clan', default: null },
  towerNumber: { type: Number, required: true },
  date:        { type: Date,   required: true },
  enemyClan:   { type: Schema.Types.ObjectId, ref: 'Clan', default: null },
  roster: {
    group1: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
    group2: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
    group3: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
  },
  confirmed: [{ type: Schema.Types.ObjectId, ref: 'Character' }],
  result:    { type: String, enum: ['victory', 'defeat', 'draw', 'pending'], default: 'pending' },
  active:    { type: Boolean, default: true },
  completed: { type: Boolean, default: false },
}, { timestamps: true });

export default model<IAccursedTower>('AccursedTower', accursedTowerSchema);
