import { Schema, model } from 'mongoose';
import type { IAttendance } from '../types';

const attendanceSchema = new Schema<IAttendance>({
  clan:         { type: Schema.Types.ObjectId, ref: 'Clan', required: true },
  activityType: { type: String, enum: ['shadow_war'], default: 'shadow_war', required: true },
  shadowWar:    { type: Schema.Types.ObjectId, ref: 'ShadowWar', required: true },
  date:         { type: Date, required: true },
  character:    { type: Schema.Types.ObjectId, ref: 'Character', required: true },
  attended:     { type: Boolean, required: true },
  markedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

attendanceSchema.index({ shadowWar: 1, character: 1 }, { unique: true });
attendanceSchema.index({ clan: 1, date: 1 });

export default model<IAttendance>('Attendance', attendanceSchema);
