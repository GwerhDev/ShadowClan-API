import { Schema, model } from 'mongoose';
import type { ICharacterCreationRequest } from '../types';

const characterCreationRequestSchema = new Schema<ICharacterCreationRequest>({
  user:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name:         { type: String, required: true },
  currentClass: { type: String, required: true },
  resonance:    { type: Number },
  status:       { type: String, default: 'pending' },
}, { timestamps: true });

export default model<ICharacterCreationRequest>('CharacterCreationRequest', characterCreationRequestSchema);
