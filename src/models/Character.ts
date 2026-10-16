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

// Nombre único sin distinguir mayúsculas (mismo criterio que las búsquedas con $regex 'i').
characterSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
characterSchema.index({ clan: 1 });

export default model<ICharacter>('Character', characterSchema);
