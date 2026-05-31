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
  whatsapp?:         string;
}

export interface IClan extends Document {
  name: string;
  status: ClanStatus;
  member: Types.ObjectId[];
  officer: Types.ObjectId[];
  leader?: Types.ObjectId;
}

export interface IMatchGroup {
  character: Types.ObjectId[];
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
  confirmed: Types.ObjectId[];
  completed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAccursedTowerRoster {
  group1: Types.ObjectId[];
  group2: Types.ObjectId[];
  group3: Types.ObjectId[];
}

export interface IAccursedTower extends Document {
  clan?: Types.ObjectId;
  towerNumber: number;
  date: Date;
  enemyClan?: Types.ObjectId;
  roster: IAccursedTowerRoster;
  confirmed: Types.ObjectId[];
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
