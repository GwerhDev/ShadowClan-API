import { Schema, model } from 'mongoose';
import type { ICharacter } from '../types';

const characterSchema = new Schema<ICharacter>({
  name:             { type: String, required: true },
  status:           { type: String, default: 'unclaimed' },
  memberStatus:     { type: String, default: 'activo' },
  resonance:        { type: Number },
  currentClass:     { type: String },
  clan:             { type: Schema.Types.ObjectId, ref: 'Clan' },
  armor:            { type: Number },
  armorPenetration: { type: Number },
  power:            { type: Number },
  resistance:       { type: Number },
  score:            { type: Number },
  whatsapp:         { type: String },
});

export default model<ICharacter>('Character', characterSchema);
