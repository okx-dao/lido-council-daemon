import { defaultAbiCoder } from '@ethersproject/abi';
import { Signature } from '@ethersproject/bytes';
import { keccak256 } from '@ethersproject/keccak256';
import { formatEther } from '@ethersproject/units';
import { Wallet } from '@ethersproject/wallet';
import {
  Inject,
  Injectable,
  LoggerService,
  OnModuleInit,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { OneAtTime } from 'common/decorators';
import { METRIC_ACCOUNT_BALANCE } from 'common/prometheus';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Gauge, register } from 'prom-client';
import { ProviderService } from 'provider';
import {
  WALLET_BALANCE_UPDATE_BLOCK_RATE,
  WALLET_MIN_BALANCE,
  WALLET_PRIVATE_KEY,
} from './wallet.constants';
import { solidityPack } from 'ethers/lib/utils';

@Injectable()
export class WalletService implements OnModuleInit {
  constructor(
    @InjectMetric(METRIC_ACCOUNT_BALANCE) private accountBalance: Gauge<string>,
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    @Inject(WALLET_PRIVATE_KEY) private privateKey: string,
    private providerService: ProviderService,
  ) {}

  async onModuleInit() {
    const guardianAddress = this.address;
    register.setDefaultLabels({ guardianAddress });

    try {
      await this.updateBalance();
      this.subscribeToEthereumUpdates();
    } catch (error) {
      this.logger.error(error);
    }
  }

  /**
   * Subscribes to the event of a new block appearance
   */
  public subscribeToEthereumUpdates() {
    this.providerService.provider.on('block', async (blockNumber) => {
      if (blockNumber % WALLET_BALANCE_UPDATE_BLOCK_RATE !== 0) return;
      this.updateBalance().catch((error) => this.logger.error(error));
    });

    this.logger.log('WalletService subscribed to Ethereum events');
  }

  /**
   * Updates the guardian account balance
   */
  @OneAtTime()
  public async updateBalance() {
    const balanceWei = await this.providerService.provider.getBalance(
      this.address,
    );
    const formatted = `${formatEther(balanceWei)} ETH`;
    const isSufficient = balanceWei.gte(WALLET_MIN_BALANCE);

    this.accountBalance.set(Number(formatEther(balanceWei)));

    if (isSufficient) {
      this.logger.log('Account balance is sufficient', { balance: formatted });
    } else {
      this.logger.warn('Account balance is too low', { balance: formatted });
    }
  }

  /**
   * Wallet class inherits Signer and can sign transactions and messages
   * using a private key as a standard Externally Owned Account (EOA)
   */
  public get wallet(): Wallet {
    if (this.cachedWallet) return this.cachedWallet;

    if (!this.privateKey) {
      this.logger.warn(
        'Private key is not provided, a random address will be generated for the test run',
      );

      this.privateKey = Wallet.createRandom().privateKey;
    }

    this.cachedWallet = new Wallet(this.privateKey);
    return this.cachedWallet;
  }

  private cachedWallet: Wallet | null = null;

  /**
   * Guardian wallet address
   */
  public get address(): string {
    return this.wallet.address;
  }

  /**
   * Signs a message using a private key
   * @param message - message that is signed
   * @returns signature
   */
  public signMessage(message: string): Signature {
    return this.wallet._signingKey().signDigest(message);
  }

  /**
   * Signs a message to deposit buffered ethers
   * @returns signature
   */
  public async signDepositData(
    prefix: string,
    blockNumber: number,
    blockHash: string,
    depositRoot: string,
    indexs: number[],
  ): Promise<Signature> {
    const encodedData = solidityPack(
      ['bytes32', 'uint256', 'bytes32', 'bytes32', 'uint256[]'],
      [prefix, blockNumber, blockHash, depositRoot, indexs],
    );

    const messageHash = keccak256(encodedData);
    console.log('messageHash:', messageHash);
    return await this.signMessage(messageHash);
  }

  /**
   * Signs a message to pause deposits
   * @returns signature
   */
  public async signPauseData(
    prefix: string,
    blockNumber: number,
    index: number,
    slashAmount: bigint,
  ): Promise<Signature> {
    const encodedData = solidityPack(
      ['bytes32', 'uint256', 'uint256', 'uint256'],
      [prefix, blockNumber, index, slashAmount],
    );

    const messageHash = keccak256(encodedData);
    return this.signMessage(messageHash);
  }
}
