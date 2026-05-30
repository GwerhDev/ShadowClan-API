import { Schema, model } from 'mongoose';
import type { IClanPost } from '../types';

const clanPostSchema = new Schema<IClanPost>({
  clan:        { type: Schema.Types.ObjectId, ref: 'Clan',      required: true },
  author:      { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  content:     { type: String, default: '', maxlength: 1000 },
  source:      { type: String, enum: ['general', 'shadow_war', 'accursed_tower'], default: 'general' },
  referenceId: { type: Schema.Types.ObjectId, default: null },
  auto:        { type: Boolean, default: false },
}, { timestamps: true });

export default model<IClanPost>('ClanPost', clanPostSchema);
