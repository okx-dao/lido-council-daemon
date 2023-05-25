import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { DawnDepositAbi, DawnDepositAbi__factory, LocatorAbi } from 'generated';
import { SecurityAbi, SecurityAbi__factory } from 'generated';
import {
  DepositNodeOperatorAbi,
  DepositNodeOperatorAbi__factory,
} from 'generated';
import { StakingRouterAbi, StakingRouterAbi__factory } from 'generated';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { BlockTag, ProviderService } from 'provider';
import { sleep } from 'utils';
import { LocatorService } from './locator/locator.service';
import {
  DEPOSIT_NODE_OPERATOR_ABI,
  DSM_ABI,
  INIT_CONTRACTS_TIMEOUT,
  DAWN_DEPOSIT_ABI,
  STAKING_ROUTER_ABI,
} from './repository.constants';

@Injectable()
export class RepositoryService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    private providerService: ProviderService,
    private locatorService: LocatorService,
  ) {}
  private tempContractsCache: Record<
    string,
    DawnDepositAbi | LocatorAbi | SecurityAbi | StakingRouterAbi
  > = {};
  // store prefixes on the current state of the contracts.
  // if the contracts are updated we will change these addresses too
  private cachedDSMPrefixes: Record<string, string> = {};
  private permanentContractsCache: Record<string, DepositNodeOperatorAbi> = {};

  /**
   * Init cache for each contract
   */
  public async initCachedContracts(blockTag: BlockTag) {
    await this.initCachedLidoContract(blockTag);
    // order is important: deposit contract depends on dsm
    await this.initCachedDSMContract(blockTag);
    await this.initCachedDepositContract(blockTag);
    await this.initCachedStakingRouterAbiContract(blockTag);
  }

  /**
   * Init cache for each contract or wait if it makes some error
   */
  public async initOrWaitCachedContracts() {
    const block = await this.providerService.getBlock();
    try {
      await this.initCachedContracts({ blockHash: block.hash });
      return block;
    } catch (error) {
      this.logger.error('Init contracts error. Retry', error);
      await sleep(INIT_CONTRACTS_TIMEOUT);
      return await this.initOrWaitCachedContracts();
    }
  }

  /**
   * Get Lido contract impl
   */
  public getCacheDawnDepositContract(): DawnDepositAbi {
    return this.getFromCache(DAWN_DEPOSIT_ABI) as DawnDepositAbi;
  }

  /**
   * Get DSM contract impl
   */
  public getCachedDSMContract(): SecurityAbi {
    return this.getFromCache(DSM_ABI) as SecurityAbi;
  }

  /**
   * Get Deposit contract impl
   */
  public getCachedDepositNodeOperatorContract(): DepositNodeOperatorAbi {
    return this.permanentContractsCache[
      DEPOSIT_NODE_OPERATOR_ABI
    ] as DepositNodeOperatorAbi;
  }

  /**
   * Get SR contract impl
   */
  public getCachedStakingRouterContract(): StakingRouterAbi {
    return this.getFromCache(STAKING_ROUTER_ABI) as StakingRouterAbi;
  }

  /**
   * Get cached contract impl
   */
  private getFromCache(abiKey: string) {
    const contract = this.tempContractsCache[abiKey];
    if (contract) return contract;
    throw new Error(`Not found ABI for key: ${abiKey}`);
  }

  /**
   * Set contract cache and log on event
   */
  public setContractCache(
    address: string,
    contractKey: string,
    impl: DawnDepositAbi | LocatorAbi | SecurityAbi | StakingRouterAbi,
  ) {
    if (!this.tempContractsCache[contractKey]) {
      this.logger.log('Contract initial address', { address, contractKey });
    }

    if (
      this.tempContractsCache[contractKey] &&
      this.tempContractsCache[contractKey].address !== address
    ) {
      this.logger.log('Contract address was changed', { address, contractKey });
    }

    this.tempContractsCache[contractKey] = impl;
  }

  private setPermanentContractCache(
    address: string,
    contractKey: string,
    impl: DepositNodeOperatorAbi,
  ) {
    this.logger.log('Contract initial address', { address, contractKey });
    this.permanentContractsCache[contractKey] = impl;
  }

  /**
   * Init cache for Lido contract
   */
  private async initCachedLidoContract(blockTag: BlockTag): Promise<void> {
    const address = await this.locatorService.getLidoAddress(blockTag);
    const provider = this.providerService.provider;

    this.setContractCache(
      address,
      DAWN_DEPOSIT_ABI,
      DawnDepositAbi__factory.connect(address, provider),
    );
  }

  /**
   * Init cache for DSM contract
   */
  private async initCachedDSMContract(blockTag: BlockTag): Promise<void> {
    const address = await this.locatorService.getDSMAddress(blockTag);
    const provider = this.providerService.provider;

    this.setContractCache(
      address,
      DSM_ABI,
      SecurityAbi__factory.connect(address, provider),
    );

    // prune dsm prefixes
    this.cachedDSMPrefixes = {};

    // re-init dsm prefixes
    await Promise.all([
      this.getAttestMessagePrefix(),
      this.getPauseMessagePrefix(),
    ]);
  }

  /**
   * Init cache for Deposit contract
   */
  private async initCachedDepositContract(blockTag: BlockTag): Promise<void> {
    if (this.permanentContractsCache[DEPOSIT_NODE_OPERATOR_ABI]) return;
    const depositAddress = await this.getDepositAddress(blockTag);
    const provider = this.providerService.provider;

    this.setPermanentContractCache(
      depositAddress,
      DEPOSIT_NODE_OPERATOR_ABI,
      DepositNodeOperatorAbi__factory.connect(depositAddress, provider),
    );
  }

  /**
   * Init cache for SR contract
   */
  private async initCachedStakingRouterAbiContract(
    blockTag: BlockTag,
  ): Promise<void> {
    const stakingRouterAddress =
      await this.locatorService.getStakingRouterAddress(blockTag);
    const provider = this.providerService.provider;

    this.setContractCache(
      stakingRouterAddress,
      STAKING_ROUTER_ABI,
      StakingRouterAbi__factory.connect(stakingRouterAddress, provider),
    );
  }

  /**
   * Returns a prefix from the contract with which the deposit message should be signed
   */
  public async getAttestMessagePrefix(): Promise<string> {
    if (this.cachedDSMPrefixes.attest) return this.cachedDSMPrefixes.attest;
    const contract = await this.getCachedDSMContract();
    this.cachedDSMPrefixes.attest = await contract.ATTEST_MESSAGE_PREFIX();
    return this.cachedDSMPrefixes.attest;
  }

  /**
   * Returns a prefix from the contract with which the pause message should be signed
   */
  public async getPauseMessagePrefix(): Promise<string> {
    if (this.cachedDSMPrefixes.pause) return this.cachedDSMPrefixes.pause;
    const contract = await this.getCachedDSMContract();
    this.cachedDSMPrefixes.pause = await contract.PAUSE_MESSAGE_PREFIX();

    return this.cachedDSMPrefixes.pause;
  }

  /**
   * Returns Deposit contract address
   */
  public async getDepositAddress(blockTag: BlockTag): Promise<string> {
    const contract = await this.getCachedDSMContract();

    return contract.DEPOSIT_CONTRACT({ blockTag: blockTag as any });
  }
}
