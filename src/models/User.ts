import { Schema, model } from 'mongoose';
import type { IUser } from '../types';

const userSchema = new Schema<IUser>({
  battlenetId: { type: String, required: true },
  battletag:   { type: String, required: true },
  provider:    { type: String, required: true },
  status:      { type: String, required: true },
  phone:       { type: String },
  role:        { type: String, required: true },
  character:   [{ type: Schema.Types.ObjectId, ref: 'Character' }],
}, { timestamps: true });

export default model<IUser>('User', userSchema);
