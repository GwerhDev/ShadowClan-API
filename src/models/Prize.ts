import { Schema, model } from 'mongoose';
import type { IPrize } from '../types';

// Catálogo de premios para sorteos (CRUD en Dashboard; líderes/oficiales eligen entre los activos).
const prizeSchema = new Schema<IPrize>({
  name:        { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  active:      { type: Boolean, default: true },
}, { timestamps: true });

prizeSchema.index({ active: 1, name: 1 });

export default model<IPrize>('Prize', prizeSchema);
