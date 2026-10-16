import { Schema, model } from 'mongoose';
import type { ICycle } from '../types';

const cycleSchema = new Schema<ICycle>({
  clan:         { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  activityType: { type: String, enum: ['shadow', 'immortal'], required: true },
  startDate:    { type: Date, required: true },
  endDate:      { type: Date },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

cycleSchema.index({ clan: 1, activityType: 1, startDate: -1 });

export default model<ICycle>('Cycle', cycleSchema);
