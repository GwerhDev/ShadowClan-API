import { Schema, model } from 'mongoose';
import type { IAttendanceCycle } from '../types';

const attendanceCycleSchema = new Schema<IAttendanceCycle>({
  clan:         { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  activityType: { type: String, enum: ['shadow_war', 'accursed_tower'], required: true },
  name:         { type: String, required: true },
  startDate:    { type: Date, required: true },
  endDate:      { type: Date, required: true },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default model<IAttendanceCycle>('AttendanceCycle', attendanceCycleSchema);
