import { Schema, model } from 'mongoose';
import type { ICrest } from '../types';

const crestSchema = new Schema<ICrest>({
  date:           { type: Date,    required: true },
  type:           { type: String,  required: true },
  quantity:       { type: Number,  required: true },
  legendaryFound: { type: Boolean, default: false },
  user:           { type: Schema.Types.ObjectId, ref: 'User' },
  character:      { type: Schema.Types.ObjectId, ref: 'Character' },
});

export default model<ICrest>('Crest', crestSchema);
