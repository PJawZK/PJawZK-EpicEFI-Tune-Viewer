export type TuneDetails = {
  author: string;
  tuneComment: string;
  writeDate: string;
  fileFormat: string;
  firmwareInfo: string;
  nPages: number | null;
  signature: string;
};

export type TuneConstant = {
  name: string;
  value: string;
  units: string | null;
  page: number | null;
  rows: number | null;
  cols: number | null;
};

export type ParsedTune = {
  details: TuneDetails;
  constants: TuneConstant[];
};

export type IniConstantKind = 'scalar' | 'bits' | 'array' | 'string' | 'unknown';

export type IniConstantDefinition = {
  name: string;
  kind: IniConstantKind;
  dataType: string;
  page: number | null;
  offset: number | null;
  units: string;
  rows: number | null;
  cols: number | null;
  scale: string | null;
  translate: string | null;
  digits: string | null;
  min: string | null;
  max: string | null;
  options: string[];
};

export type IniTableDefinition = {
  id: string;
  mapId: string;
  title: string;
  page: number | null;
  help: string;
  xBins: string;
  yBins: string;
  zBins: string;
  xLabel: string;
  yLabel: string;
};

export type IniCurveDefinition = {
  id: string;
  title: string;
  labels: string[];
  xBins: string[];
  yBins: string[];
  xAxis: string[];
  yAxis: string[];
  gauge: string;
};

export type IniDialogField = {
  title: string;
  name: string;
  condition: string;
};

export type IniDialogPanel = {
  name: string;
  layout: string;
  condition: string;
};

export type IniDialogDefinition = {
  id: string;
  title: string;
  layout: string;
  help: string;
  fields: IniDialogField[];
  panels: IniDialogPanel[];
};

export type IniMenuItem =
  | {
      type: 'item';
      target: string;
      title: string;
      condition: string;
    }
  | {
      type: 'separator';
      target: string;
      title: string;
      condition: string;
    }
  | {
      type: 'group';
      title: string;
      children: IniMenuItem[];
    };

export type IniMenuDefinition = {
  id: string;
  title: string;
  items: IniMenuItem[];
};

export type ParsedIni = {
  signature: string;
  constants: IniConstantDefinition[];
  tables: IniTableDefinition[];
  curves: IniCurveDefinition[];
  dialogs: IniDialogDefinition[];
  menus: IniMenuDefinition[];
  labelSets: Record<string, string[]>;
};

export const validationStatuses = [
  'Unverified',
  'Starts/Idles',
  'Driven',
  'Road Tested',
  'Performance Tested',
  'Track Tested',
  'Dyno Tested',
  'EpicEFI Verified',
] as const;

export const tuneClassifications = [
  'Normal',
  'Experimental',
  'Base Tune',
  'Development',
] as const;


export type ValidationStatus = (typeof validationStatuses)[number];
export type TuneClassification = (typeof tuneClassifications)[number];

export type TuneVehicleMetadata = {
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
};

export type TuneEngineMetadata = {
  make?: string;
  code?: string;
  displacementLiters?: number;
  cylinders?: number;
  aspiration?: string;
  compressionRatio?: number;
};

export type PublishedTuneFiles = {
  msq: string;
  ini?: string;
};

export type PublishedTuneMetadata = {
  id: string;
  title: string;
  summary?: string;
  author: string;
  publishedAt: string;
  updatedAt?: string;
  ecuTarget: string;
  firmwareSignature: string;
  validationStatus: ValidationStatus;
  classification: TuneClassification;
  vehicle?: TuneVehicleMetadata;
  engine?: TuneEngineMetadata;
  fuel?: string;
  ignition?: string;
  injectorCc?: number;
  powerHp?: number;
  stockPowerHp?: number;
  torqueNm?: number;
  boostBar?: number;
  tags: string[];
  notes?: string;
  versionLabel?: string;
  parentTuneId?: string;
  files: PublishedTuneFiles;
};

export type PublishedTuneIndex = {
  schema: number;
  tunes: PublishedTuneMetadata[];
};
