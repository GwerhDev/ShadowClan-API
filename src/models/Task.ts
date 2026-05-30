import { Schema, model } from 'mongoose';
import type { ITask } from '../types';

const taskSchema = new Schema<ITask>({
  date:      { type: Date },
  type:      { type: String, required: true },
  title:     { type: String, required: true },
  fixed:     { type: Boolean, required: true },
  user:      { type: Schema.Types.ObjectId, ref: 'User' },
  character: { type: Schema.Types.ObjectId, ref: 'Character' },
});

export default model<ITask>('Task', taskSchema);
