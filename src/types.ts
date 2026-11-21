export type Role = 'homeowner' | 'inspector' | 'director';
export type ThemeId = 'obsidian' | 'blueprint' | 'daylight' | 'eco';
export type ModuleId = 'impact' | 'hydro' | 'rt60' | 'level' | 'vault';
export type ViewMode = 'desktop' | 'mobile';

export type MaterialKind = 'hollow' | 'stud' | 'pipe' | 'conduit' | 'tile';
export type Verdict = 'HOLLOW' | 'STUD' | 'PIPE' | 'CONDUIT' | 'TILE';

export interface EchoReading {
  centroidHz: number;
  decayMs: number;
  magnetUt: number;
  hum60: number;
  confidence: number;
  kind: MaterialKind;
  verdict: Verdict;
  severity: 'safe' | 'caution' | 'danger';
  note: string;
}

export interface WallScanRecord {
  id?: number;
  name: string;
  property: string;
  createdAt: number;
  spanInches: number;
  verdicts: { x: number; kind: MaterialKind; centroidHz: number }[];
  studCenters: number[];
  hazards: number;
  notes: string;
}

export interface LeakRecord {
  id?: number;
  property: string;
  createdAt: number;
  scenario: string;
  peakHz: number;
  bandDb: number;
  flowLpm: number;
  gallonsMonth: number;
  costYear: number;
  dewPointC: number;
  moldRisk: 'LOW' | 'MODERATE' | 'CRITICAL';
  notes: string;
}

export interface RoomRecord {
  id?: number;
  name: string;
  createdAt: number;
  lengthM: number;
  widthM: number;
  heightM: number;
  rt60Bands: Record<string, number>;
  targetRt60: number;
  modeCount: number;
  treatment: string;
}

export interface CheckItemRecord {
  id?: number;
  label: string;
  room: string;
  done: boolean;
  score: number;
  updatedAt: number;
}

export interface SyncMutation {
  id?: number;
  entity: 'scan' | 'leak' | 'room' | 'check';
  action: 'create' | 'update' | 'delete';
  payload: string;
  createdAt: number;
  synced: 0 | 1;
}

export type SensorKey = 'mic' | 'motion' | 'camera' | 'haptics';
export type SensorState = 'ACTIVE' | 'SIMULATOR ACTIVE' | 'RESTRICTED' | 'IDLE';
