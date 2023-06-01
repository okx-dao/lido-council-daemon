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
  getDepositNodeOperatorAddress,
  getDepositSecurityAddress,
} from './security.constants';
import {
  DawnDepositAbi,
  DawnDepositAbi__factory,
  DepositNodeOperatorAbi,
  DepositNodeOperatorAbi__factory,
} from '../../generated';
import { BigNumber } from '@ethersproject/bignumber';

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

  private cachedContractWithSigner: SecurityAbi | null = null;
  private cachedNosContractWithSigner: DepositNodeOperatorAbi | null = null;
  private cachedDawnDepositContractWithSigner: DawnDepositAbi | null = null;

  private cachedAttestMessagePrefix: string | null = null;
  private cachedPauseMessagePrefix: string | null = null;

  public async onModuleInit(): Promise<void> {
    const guardianIndex = await this.getGuardianIndex('latest');
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
      const provider = this.providerService.provider;
      this.cachedContract = SecurityAbi__factory.connect(address, provider);
    }

    return this.cachedContract;
  }

  /**
   * Returns an instance of the contract
   */
  public async getNosContract(): Promise<DepositNodeOperatorAbi> {
    if (!this.cachedNosContract) {
      const address = await this.getDepositNodeOperatorServiceAddress();
      const provider = this.providerService.provider;
      this.cachedNosContract = DepositNodeOperatorAbi__factory.connect(
        address,
        provider,
      );
    }

    return this.cachedNosContract;
  }

  public async getDawnDepositContract(): Promise<DawnDepositAbi> {
    if (!this.cachedDawnDepositContract) {
      const address = await this.getDawnDepositServiceAddress();
      const provider = this.providerService.provider;
      this.cachedDawnDepositContract = DawnDepositAbi__factory.connect(
        address,
        provider,
      );
    }

    return this.cachedDawnDepositContract;
  }

  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getContractWithSigner(): Promise<SecurityAbi> {
    if (!this.cachedContractWithSigner) {
      const wallet = this.walletService.wallet;
      const provider = this.providerService.provider;
      const walletWithProvider = wallet.connect(provider);
      const contract = await this.getContract();
      const contractWithSigner = contract.connect(walletWithProvider);

      this.cachedContractWithSigner = contractWithSigner;
    }

    return this.cachedContractWithSigner;
  }
  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getNosContractWithSigner(): Promise<DepositNodeOperatorAbi> {
    if (!this.cachedNosContractWithSigner) {
      const wallet = this.walletService.wallet;
      const provider = this.providerService.provider;
      const walletWithProvider = wallet.connect(provider);
      const contract = await this.getNosContract();
      const contractWithSigner = contract.connect(walletWithProvider);

      this.cachedNosContractWithSigner = contractWithSigner;
    }

    return this.cachedNosContractWithSigner;
  }
  /**
   * Returns an instance of the contract that can send signed transactions
   */
  public async getDawnDepositContractWithSigner(): Promise<DawnDepositAbi> {
    if (!this.cachedDawnDepositContractWithSigner) {
      const wallet = this.walletService.wallet;
      const provider = this.providerService.provider;
      const walletWithProvider = wallet.connect(provider);
      const contract = await this.getDawnDepositContract();
      const contractWithSigner = contract.connect(walletWithProvider);

      this.cachedDawnDepositContractWithSigner = contractWithSigner;
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

  public async getDawnDepositServiceAddress(): Promise<string> {
    const chainId = await this.providerService.getChainId();
    return getDawnDepositOperatorAddress(chainId);
  }
  /**
   * Returns an address of the deposit contract from the security contract
   */
  public async getDepositContractAddress() {
    const contract = await this.getContract();
    const address = await contract.DEPOSIT_CONTRACT();

    return address;
  }

  /**
   * Returns an address of the Lido contract from the security contract
   */
  public async getLidoContractAddress() {
    const contract = await this.getContract();
    const address = await contract.LIDO();

    return address;
  }

  /**
   * Returns a prefix from the contract with which the deposit message should be signed
   */
  public async getAttestMessagePrefix(): Promise<string> {
    if (!this.cachedAttestMessagePrefix) {
      const contract = await this.getContract();
      const messagePrefix = await contract.ATTEST_MESSAGE_PREFIX();
      this.cachedAttestMessagePrefix = messagePrefix;
    }

    return this.cachedAttestMessagePrefix;
  }

  /**
   * Returns a prefix from the contract with which the pause message should be signed
   */
  public async getPauseMessagePrefix(): Promise<string> {
    if (!this.cachedPauseMessagePrefix) {
      const contract = await this.getContract();
      const messagePrefix = await contract.PAUSE_MESSAGE_PREFIX();
      this.cachedPauseMessagePrefix = messagePrefix;
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
  public async getGuardianIndex(blockTag?: BlockTag): Promise<number> {
    const address = this.walletService.address;
    return 0;
  }

  /**
   * Returns guardian address
   */
  public getGuardianAddress(): string {
    return this.walletService.address;
  }

  /**
   * Signs a message to deposit buffered ethers with the prefix from the contract
   */
  public async signDepositData(
    indexs: number[],
    blockNumber: number,
    blockHash: string,
  ): Promise<Signature> {
    const messagePrefix = await this.getAttestMessagePrefix();

    const contract = await this.getNosContractWithSigner();

    const tx = await contract.activateValidators(indexs);
    await tx.wait();
    return await this.walletService.signDepositData(
      messagePrefix,
      'depositRoot',
      0,
      blockNumber,
      blockHash,
    );
  }

  /**
   * Signs a message to pause deposits with the prefix from the contract
   */
  public async signPauseData(blockNumber: number): Promise<Signature> {
    const messagePrefix = await this.getPauseMessagePrefix();

    return await this.walletService.signPauseData(messagePrefix, blockNumber);
  }

  /**
   * Returns the current state of deposits
   */
  public async isNotEnough(blockTag?: BlockTag): Promise<boolean> {
    const contract = await this.getDawnDepositContract();
    const bufferedEther = await contract.getBufferedEther({ blockTag });
    return bufferedEther.gt(BigNumber.from('32000000000000000000'));
  }

  /**
   * Sends a transaction to pause deposits
   * @param index
   * @param signature - message signature
   */
  @OneAtTime()
  public async pauseAKeyDeposits(
    index: number,
    signature: Signature,
  ): Promise<ContractReceipt | void> {
    this.logger.warn('Try to pause deposits');
    this.pauseAttempts.inc();

    const contract = await this.getNosContractWithSigner();

    const { r, _vs: vs } = signature;
    const tx = await contract.setValidatorUnsafe(index, 0);

    this.logger.warn('Pause transaction sent', { txHash: tx.hash });
    this.logger.warn('Waiting for block confirmation');

    await tx.wait();
    //todo
    this.logger.warn('Block confirmation received');
  }
}
