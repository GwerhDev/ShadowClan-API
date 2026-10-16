import { Schema, model } from 'mongoose';
import type { ICharacterClaim } from '../types';

const characterClaimSchema = new Schema<ICharacterClaim>({
  user:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
  character: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  status:    { type: String, default: 'pending' },
}, { timestamps: true });

characterClaimSchema.index({ character: 1, status: 1 });

export default model<ICharacterClaim>('CharacterClaim', characterClaimSchema);
