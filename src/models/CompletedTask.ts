import { Schema, model } from 'mongoose';
import type { ICompletedTask } from '../types';

const completedTaskSchema = new Schema<ICompletedTask>({
  date:      { type: Date, required: true },
  type:      { type: String, required: true },
  user:      { type: Schema.Types.ObjectId, ref: 'User' },
  character: { type: Schema.Types.ObjectId, ref: 'Character' },
  tasks:     [{ type: Schema.Types.ObjectId, ref: 'Task' }],
});

export default model<ICompletedTask>('CompletedTask', completedTaskSchema);
