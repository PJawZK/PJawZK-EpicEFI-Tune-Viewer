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
  options: string[];
};

export type IniTableDefinition = {
  id: string;
  mapId: string;
  title: string;
  xBins: string;
  yBins: string;
  zBins: string;
  xLabel: string;
  yLabel: string;
};

export type ParsedIni = {
  signature: string;
  constants: IniConstantDefinition[];
  tables: IniTableDefinition[];
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
