import type { SelectOption } from './SelectMenu';

export const supportedEcuTargets: SelectOption[] = [
  { value: 'epicEFI', label: 'epicECU / epicEFI' },
  { value: 'epicECU', label: 'epicECU' },
  { value: 'uaefi', label: 'uaEFI (F4)' },
  { value: 'uaefi_pro', label: 'uaEFI Pro (F7)' },
  { value: 'uaefiBIGFUEL', label: 'uaEFI BIGFUEL' },
  { value: 'uaefi_pro_bigfuel', label: 'uaEFI Pro BIGFUEL' },
  { value: 'uaefi-obd1', label: 'uaEFI Honda OBD1' },
  { value: 'uaefi121', label: 'uaEFI 121 Pin' },
  { value: 'proteus_f4', label: 'Proteus F4' },
  { value: 'mre_f4', label: 'microRusEFI / MRE F4' },
  { value: 'bossbrain_f427', label: 'BossBrain F427' },
  { value: 'BossECU_48', label: 'BossECU 48' },
  { value: 'paralela', label: 'AlphaECU Brainboard / paralela' },
  { value: 'alphax-silver', label: 'AlphaECU Silver' },
  { value: 'alphax-gold', label: 'AlphaECU Gold' },
  { value: 'KLM_BrainBoard', label: 'KLM BrainBoard' },
  { value: 'MEGA144H7', label: 'MEGA144H7' },
  { value: 'MEGA100F4', label: 'MEGA100F4' },
  { value: 'MEGA100', label: 'MEGA100' },
  { value: 'M144F7RED', label: 'M144F7RED / UA4C' },
];

export function mergeEcuTargets(...extraValues: Array<string | undefined | null>): SelectOption[] {
  const byValue = new Map<string, SelectOption>(
    supportedEcuTargets.map((option) => [option.value, option]),
  );

  for (const raw of extraValues) {
    const value = raw?.trim();
    if (value && !byValue.has(value)) {
      byValue.set(value, { value, label: value });
    }
  }

  return [...byValue.values()].sort((left, right) =>
    (left.label ?? left.value).localeCompare(right.label ?? right.value),
  );
}
