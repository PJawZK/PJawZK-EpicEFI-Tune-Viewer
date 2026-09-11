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
