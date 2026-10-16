import { Schema, model } from 'mongoose';
import type { ISeason } from '../types';

const seasonSchema = new Schema<ISeason>({
  clan:      { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  startDate: { type: Date, required: true },
  endDate:   { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

seasonSchema.index({ clan: 1, startDate: -1 });

export default model<ISeason>('Season', seasonSchema);
