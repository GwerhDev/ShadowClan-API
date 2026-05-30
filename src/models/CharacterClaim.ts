import { Schema, model } from 'mongoose';
import type { ICharacterClaim } from '../types';

const characterClaimSchema = new Schema<ICharacterClaim>({
  user:      { type: Schema.Types.ObjectId, ref: 'User',      required: true },
  character: { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  status:    { type: String, default: 'pending' },
}, { timestamps: true });

export default model<ICharacterClaim>('CharacterClaim', characterClaimSchema);
