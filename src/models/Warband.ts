import { Schema, model } from 'mongoose';
import type { IWarband } from '../types';

const warbandSchema = new Schema<IWarband>({
  name:   { type: String, required: true },
  leader: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

export default model<IWarband>('Warband', warbandSchema);
