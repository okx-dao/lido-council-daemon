import { BigNumberish } from 'ethers';

export interface SignDepositDataParams {
  indexList: BigNumberish[];
}

export interface SignPauseDataParams {
  index: BigNumberish;
  slashAmount: BigNumberish;
}
