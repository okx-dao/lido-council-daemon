import { DepositEventGroup } from 'contracts/deposit';
import { NodeOperatorsCache } from 'contracts/registry/interfaces';

export interface validatorDate {
  nextSigningKeys: string[];
  statuses: number[];
}
