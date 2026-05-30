import { Schema, model } from 'mongoose';
import type { IClanRequest } from '../types';

const clanRequestSchema = new Schema<IClanRequest>({
  user:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
  character: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  clan:      { type: Schema.Types.ObjectId, ref: 'Clan',      required: true },
  status:    { type: String, default: 'pending' },
}, { timestamps: true });

export default model<IClanRequest>('ClanRequest', clanRequestSchema);
