import { Schema, model } from 'mongoose';
import type { ICharacter } from '../types';

const characterSchema = new Schema<ICharacter>({
  name:         { type: String, required: true },
  status:       { type: String, default: 'unclaimed' },
  memberStatus: { type: String, default: 'activo' },
  resonance:    { type: Number },
  currentClass: { type: String },
  clan:         { type: Schema.Types.ObjectId, ref: 'Clan' },
});

export default model<ICharacter>('Character', characterSchema);
