import { Document, Types } from 'mongoose';

// ── Enums ──────────────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'admin' | 'leader' | 'officer' | 'user' | 'walker';
export type UserStatus = 'active' | 'pending' | 'inactive';
export type UserProvider = 'bnet' | 'inner' | 'admin-management';

export type CharacterStatus = 'unclaimed' | 'pending' | 'claimed';
export type MemberStatus = 'activo' | 'inactivo' | 'retirado' | 'pendiente';

export type ClanStatus = 'unclaimed' | 'pending' | 'claimed';

export type MatchResult = 'victory' | 'defeat' | 'draw' | 'pending';
export type ClanPostSource = 'general' | 'shadow_war' | 'accursed_tower';

export type InvitationRole = 'officer' | 'member';
export type RequestStatus = 'pending' | 'accepted' | 'rejected';

// ── Document Interfaces ────────────────────────────────────────────────────────

export interface IUser extends Document {
  battlenetId: string;
  battletag: string;
  provider: UserProvider;
  status: UserStatus;
  phone?: string;
  role: UserRole;
  character: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ICharacter extends Document {
  name: string;
  status: CharacterStatus;
  memberStatus: MemberStatus;
  resonance?:        number;
  currentClass?:     string;
  clan?:             Types.ObjectId;
  armor?:            number;
  armorPenetration?: number;
  power?:            number;
  resistance?:       number;
  score?:            number;
  whatsapp?:         string;
}

export interface IClan extends Document {
  name: string;
  status: ClanStatus;
  member: Types.ObjectId[];
  officer: Types.ObjectId[];
  leader?: Types.ObjectId;
  savedAccursedTowerAlignments?: { last?: any; custom?: { name: string; data: any; savedAt?: Date }[] };
  savedShadowWarAlignments?: { last?: any; custom?: { name: string; data: any; savedAt?: Date }[] };
  createdAt: Date;
  updatedAt: Date;
}

export interface IMatchGroup {
  character: Array<Types.ObjectId | null>;
}

export interface IMatch extends Document {
  group1: IMatchGroup;
  group2: IMatchGroup;
  result: MatchResult;
}

export interface IBattle {
  exalted: IMatch[];
  eminent: IMatch[];
  famed: IMatch[];
  proud: IMatch[];
}

export interface IShadowWar extends Document {
  clan?: Types.ObjectId;
  date: Date;
  result?: MatchResult;
  enemyClan?: Types.ObjectId;
  battle: IBattle;
  finalBattle?: IBattle;
  confirmed: Types.ObjectId[];
  declined:  Types.ObjectId[];
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttendance extends Document {
  clan: Types.ObjectId;
  activityType: 'shadow_war';
  shadowWar: Types.ObjectId;
  date: Date;
  character: Types.ObjectId;
  attended: boolean;
  markedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICycle extends Document {
  clan: Types.ObjectId;
  activityType: 'shadow' | 'immortal';
  startDate: Date;
  endDate?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISeason extends Document {
  clan: Types.ObjectId;
  startDate: Date;
  endDate?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClanMembership extends Document {
  clan: Types.ObjectId;
  character: Types.ObjectId;
  role: 'leader' | 'officer' | 'member';
  joinedAt?: Date;
  leftAt?: Date;
  expulsionReason?: string;
  removedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAccursedTowerRoster {
  group1: Array<Types.ObjectId | null>;
  group2: Array<Types.ObjectId | null>;
  group3: Array<Types.ObjectId | null>;
}

export interface IAccursedTower extends Document {
  clan?: Types.ObjectId;
  towerNumber: number;
  date: Date;
  enemyClan?: Types.ObjectId;
  roster: IAccursedTowerRoster;
  finalRoster?: IAccursedTowerRoster;
  confirmed: Types.ObjectId[];
  declined:  Types.ObjectId[];
  result: MatchResult;
  active: boolean;
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClanPost extends Document {
  clan: Types.ObjectId;
  author: Types.ObjectId;
  content: string;
  source: ClanPostSource;
  referenceId?: Types.ObjectId;
  auto: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClanRequest extends Document {
  user: Types.ObjectId;
  character: Types.ObjectId;
  clan: Types.ObjectId;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClanInvitation extends Document {
  clan: Types.ObjectId;
  character: Types.ObjectId;
  invitedByUser: Types.ObjectId;
  role: InvitationRole;
  proposedClass?: string;
  proposedResonance?: number;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITask extends Document {
  date: Date;
  type: string;
  title: string;
  fixed: boolean;
  user: Types.ObjectId;
  character: Types.ObjectId;
}

export interface ICompletedTask extends Document {
  user: Types.ObjectId;
  character: Types.ObjectId;
  tasks: Types.ObjectId[];
  date: Date;
  type: string;
}

export interface ICrest extends Document {
  date: Date;
  type: string;
  quantity: number;
  legendaryFound: boolean;
  user: Types.ObjectId;
  character: Types.ObjectId;
}

export interface IWarband extends Document {
  name: string;
  leader: Types.ObjectId[];
}

export interface ICharacterClaim extends Document {
  user: Types.ObjectId;
  character: Types.ObjectId;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICharacterCreationRequest extends Document {
  user: Types.ObjectId;
  name: string;
  currentClass: string;
  resonance?: number;
  status: RequestStatus;
  createdAt: Date;
  updatedAt: Date;
}
