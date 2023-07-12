import { Signature } from '@ethersproject/bytes';
import { ContractReceipt } from '@ethersproject/contracts';
import { BlockTag } from '@ethersproject/abstract-provider';
import {
  Inject,
  Injectable,
  LoggerService,
  OnModuleInit,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { METRIC_PAUSE_ATTEMPTS } from 'common/prometheus';
import { OneAtTime } from 'common/decorators';
import { SecurityAbi__factory } from 'generated/factories/SecurityAbi__factory';
import { SecurityAbi } from 'generated/SecurityAbi';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Counter } from 'prom-client';
import { ProviderService } from 'provider';
import { WalletService } from 'wallet';
import {
  getDawnDepositOperatorAddress,
  getDawnDepositSecurityAddress,
  getDepositNodeOperatorAddress,
  getDepositSecurityAddress,
} from './security.constants';
import {
  DawnDepositAbi,
  DawnDepositAbi__factory,
  DawnDepositSecuritymoduleAbi,
  DawnDepositSecuritymoduleAbi__factory,
  DepositNodeOperatorAbi,
  DepositNodeOperatorAbi__factory,
} from '../../generated';

@Injectable()
export class SecurityService implements OnModuleInit {
  constructor(
    @InjectMetric(METRIC_PAUSE_ATTEMPTS) private pauseAttempts: Counter<string>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    private providerService: ProviderService,
    private walletService: WalletService,
  ) {}

  private cachedContract: SecurityAbi | null = null;
  private cachedNosContract: DepositNodeOperatorAbi | null = null;
  private cachedDawnDepositContract: DawnDepositAbi | null = null;

  private cachedDawnDepositSecurityContract: DawnDepositSecuritymoduleAbi | null =
    null;

  private cachedContractWithSigner: SecurityAbi | null = null;
  private cachedNosContractWithSigner: DepositNodeOperatorAbi | null = null;
  private cachedDepositSecurityContractWithSigner: DawnDepositSecuritymoduleAbi | null =
    null;
  private cachedDawnDepositContractWithSigner: DawnDepositAbi | null = null;

  private cachedAttestMessagePrefix: string | null = null;
  private cachedPauseMessagePrefix: string | null = null;

  public async onModuleInit(): Promise<void> {
    const guardianIndex = await this.getGuardianIndex();
    const address = this.walletService.address;

    if (guardianIndex === -1) {
      this.logger.warn(`Your address is not in the Guardian List`, { address });
    } else {
      this.logger.log(`You address is in the Guardian List`, { address });
    }
  }

  /**
   * Returns an instance of the contract
   */
  public async getContract(): Promise<SecurityAbi> {
    if (!this.cachedContract) {
      const address = await this.getDepositSecurityAddress();
      this.cachedContract = SecurityAbi__factory.connect(
        address,
        this.providerService.provider,
      );
    }

    return this.cachedContract;
  }

  /**
   * Returns an instance of the contract
   */
  public async getNosContract(): Promise<DepositNodeOperatorAbi> {
    if (!this.cachedNosContract) {
      const address = await this.getDepositNodeOperatorServiceAddress();
      this.cachedNosContract = DepositNodeOperatorAbi__factory.connect(
        address,
        this.providerService.provider,
      );
    }

    return this.cachedNosContract;
  }

  public async getDawnDepositContract(): Promise<DawnDepositAbi> {
    if (!this.cachedDawnDepositContract) {
      const address = await this.getDawnDepositServiceAddress();
      this.cachedDawnDepositContract = DawnDepositAbi__factory.connect(
        address,
        this.providerService.provider,
      );
    }

    return this.cachedDawnDepositContract;
  }

  public async getDawnDepositSecurityContract(): Promise<DawnDepositSecuritymoduleAbi> {
    if (!this.cachedDawnDepositSecurityContract) {
      const address = await this.getDepositSecurityServiceAddress();
      this.cachedDawnDepositSecurityContract =
        DawnDepositSecuritymoduleAbi__factory.connect(
          address,
          this.providerService.provider,
        );
    }

    return this.cachedDawnDepositSecurityContract;
  }

  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getContractWithSigner(): Promise<SecurityAbi> {
    if (!this.cachedContractWithSigner) {
      const wallet = this.walletService.wallet;
      const walletWithProvider = wallet.connect(this.providerService.provider);
      const contract = await this.getContract();
      this.cachedContractWithSigner = contract.connect(walletWithProvider);
    }

    return this.cachedContractWithSigner;
  }
  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getNosContractWithSigner(): Promise<DepositNodeOperatorAbi> {
    if (!this.cachedNosContractWithSigner) {
      const wallet = this.walletService.wallet;
      const walletWithProvider = wallet.connect(this.providerService.provider);
      const contract = await this.getNosContract();
      this.cachedNosContractWithSigner = contract.connect(walletWithProvider);
    }

    return this.cachedNosContractWithSigner;
  }

  public async getDepositSecurityContractWithSigner(): Promise<DawnDepositSecuritymoduleAbi> {
    if (!this.cachedDepositSecurityContractWithSigner) {
      const wallet = this.walletService.wallet;
      const walletWithProvider = wallet.connect(this.providerService.provider);
      const contract = await this.getDawnDepositSecurityContract();
      this.cachedDepositSecurityContractWithSigner =
        contract.connect(walletWithProvider);
    }

    return this.cachedDepositSecurityContractWithSigner;
  }
  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getDawnDepositContractWithSigner(): Promise<DawnDepositAbi> {
    if (!this.cachedDawnDepositContractWithSigner) {
      const wallet = this.walletService.wallet;
      const walletWithProvider = wallet.connect(this.providerService.provider);
      const contract = await this.getDawnDepositContract();
      this.cachedDawnDepositContractWithSigner =
        contract.connect(walletWithProvider);
    }

    return this.cachedDawnDepositContractWithSigner;
  }
  /**
   * Returns an address of the security contract
   */
  public async getDepositSecurityAddress(): Promise<string> {
    const chainId = await this.providerService.getChainId();
    return getDepositSecurityAddress(chainId);
  }

  public async getDepositNodeOperatorServiceAddress(): Promise<string> {
    const chainId = await this.providerService.getChainId();
    return getDepositNodeOperatorAddress(chainId);
  }
  public async getDepositSecurityServiceAddress(): Promise<string> {
    const chainId = await this.providerService.getChainId();
    return getDawnDepositSecurityAddress(chainId);
  }

  public async getDawnDepositServiceAddress(): Promise<string> {
    const chainId = await this.providerService.getChainId();
    return getDawnDepositOperatorAddress(chainId);
  }
  /**
   * Returns an address of the deposit contract from the security contract
   */
  public async getDepositContractAddress() {
    const contract = await this.getContract();
    return await contract.DEPOSIT_CONTRACT();
  }

  /**
   * Returns an address of the Lido contract from the security contract
   */
  public async getLidoContractAddress() {
    const contract = await this.getContract();
    return await contract.LIDO();
  }

  /**
   * Returns a prefix from the contract with which the deposit message should be signed
   */
  public async getAttestMessagePrefix(): Promise<string> {
    if (!this.cachedAttestMessagePrefix) {
      const contract = await this.getDawnDepositSecurityContract();
      // const messagePrefix = await contract.ATTEST_MESSAGE_PREFIX();
      this.cachedAttestMessagePrefix = await contract.getAttestMessagePrefix();
    }

    return this.cachedAttestMessagePrefix;
  }

  /**
   * Returns a prefix from the contract with which the pause message should be signed
   */
  public async getPauseMessagePrefix(): Promise<string> {
    if (!this.cachedPauseMessagePrefix) {
      const contract = await this.getDawnDepositSecurityContract();
      this.cachedPauseMessagePrefix = await contract.getUnsafeMessagePrefix();
    }

    return this.cachedPauseMessagePrefix;
  }

  /**
   * Returns the maximum number of deposits per transaction from the contract
   */
  public async getMaxDeposits(blockTag?: BlockTag): Promise<number> {
    const contract = await this.getContract();
    const maxDeposits = await contract.getMaxDeposits({ blockTag });

    return maxDeposits.toNumber();
  }

  /**
   * Returns the guardian index in the list
   */
  public async getGuardianIndex(): Promise<number> {
    const contract = await this.getDawnDepositSecurityContract();
    const address = this.walletService.address;
    const index = await contract.getGuardianIndex(address);
    return index.toNumber();
  }

  /**
   * Returns guardian address
   */
  public getGuardianAddress(): string {
    return this.walletService.address;
  }

  /**
   * Return withdraw credentials
   */
  public async getWCAddress(): Promise<string> {
    const contract = await this.getDawnDepositContract();
    return await contract.getWithdrawalCredentials();
  }

  /**
   * Signs a message to deposit buffered ethers with the prefix from the contract
   */
  public async signDepositData(
    blockNumber: number,
    blockHash: string,
    depositRoot: string,
    indexs: number[],
  ): Promise<Signature> {
    const messagePrefix = await this.getAttestMessagePrefix();

    // const contract = await this.getNosContractWithSigner();

    // const tx = await contract.activateValidators(indexs);
    // await tx.wait();
    return await this.walletService.signDepositData(
      messagePrefix,
      blockNumber,
      blockHash,
      depositRoot,
      indexs,
    );
  }

  /**
   * Signs a message to pause deposits with the prefix from the contract
   */
  public async signPauseData(
    blockNumber: number,
    index: number,
    slashAmount: bigint,
  ): Promise<Signature> {
    const messagePrefix = await this.getPauseMessagePrefix();

    return await this.walletService.signPauseData(
      messagePrefix,
      blockNumber,
      index,
      slashAmount,
    );
  }

  /**
   * Returns the current state of deposits
   */
  public async isNotEnough(): Promise<boolean> {
    const contract = await this.getDawnDepositSecurityContract();
    return !(await contract.canDeposit());
  }

  /**
   * Sends a transaction to pause deposits
   */
  @OneAtTime()
  public async pauseAKeyDeposits(
    blocknumber: number,
    index: number,
    slashAmount: bigint,
    signature: Signature,
  ): Promise<ContractReceipt | void> {
    this.logger.warn('Try to pause deposits');
    this.pauseAttempts.inc();

    const contract = await this.getDepositSecurityContractWithSigner();

    const { r, _vs: vs } = signature;
    const tx = await contract.setValidatorUnsafe(
      blocknumber,
      index,
      slashAmount,
      { r, vs },
    );

    this.logger.warn('Pause transaction sent', { txHash: tx.hash });
    this.logger.warn('Waiting for block confirmation');

    await tx.wait();
    //todo
    this.logger.warn('Block confirmation received');
  }
}
