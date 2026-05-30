import mongoose from 'mongoose';
import { mongodbString } from '../config';

export class DB {
  static connect(): Promise<typeof mongoose> {
    mongoose.Promise = global.Promise;
    return mongoose.connect(mongodbString);
  }
}
