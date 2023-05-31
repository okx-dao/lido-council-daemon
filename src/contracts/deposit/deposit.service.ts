import { Inject, Injectable, LoggerService } from '@nestjs/common';
import { performance } from 'perf_hooks';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ProviderService, ERROR_LIMIT_EXCEEDED } from 'provider';
import { DepositAbi, DepositAbi__factory } from 'generated';
import { DepositEventEvent } from 'generated/DepositAbi';
import {
  DEPOSIT_EVENTS_STEP,
  DEPOSIT_EVENTS_RETRY_TIMEOUT_MS,
  getDeploymentBlockByNetwork,
  DEPOSIT_EVENTS_CACHE_UPDATE_BLOCK_RATE,
  DEPOSIT_EVENTS_CACHE_LAG_BLOCKS,
} from './deposit.constants';
import {
  DepositEvent,
  DepositEventGroup,
  DepositEventsCache,
} from './interfaces';
import { sleep } from 'utils';
import { OneAtTime } from 'common/decorators';
import { SecurityService } from 'contracts/security';
import { CacheService } from 'cache';
import { BlockData } from 'guardian';
import { BlockTag } from '@ethersproject/abstract-provider';
import { APP_VERSION } from 'app.constants';

@Injectable()
export class DepositService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER) private logger: LoggerService,
    private providerService: ProviderService,
    private securityService: SecurityService,
    private cacheService: CacheService<DepositEventsCache>,
  ) {}

  private cachedContract: DepositAbi | null = null;

  @OneAtTime()
  public async handleNewBlock({ blockNumber }: BlockData): Promise<void> {
    if (blockNumber % DEPOSIT_EVENTS_CACHE_UPDATE_BLOCK_RATE !== 0) return;
    await this.updateEventsCache();
  }

  async onModuleInit() {
    const cache = await this.getCachedEvents();
    const versions = {
      cachedVersion: cache.version,
      currentVersion: APP_VERSION,
    };

    if (cache.version === APP_VERSION) {
      this.logger.log(
        'Deposit Events cache version matches the application version',
        versions,
      );

      return;
    }

    this.logger.log(
      'Deposit Events cache does not match the application version, clearing the cache',
      versions,
    );

    try {
      await this.deleteCachedEvents();
      this.logger.log('Deposit Events cache cleared');
    } catch (error) {
      this.logger.error(error);
      process.exit(1);
    }
  }

  /**
   * Returns only required information about the event,
   * to reduce the size of the information stored in the cache
   */
  public formatEvent(rawEvent: DepositEventEvent): DepositEvent {
    const { args, transactionHash: tx, blockNumber } = rawEvent;
    const { withdrawal_credentials: wc, pubkey, amount, signature } = args;

    return { pubkey, wc, amount, signature, tx, blockNumber };
  }

  /**
   * Returns an instance of the contract
   */
  public async getContract(): Promise<DepositAbi> {
    if (!this.cachedContract) {
      const address = await this.securityService.getDepositContractAddress();
      const provider = this.providerService.provider;
      this.cachedContract = DepositAbi__factory.connect(address, provider);
    }

    return this.cachedContract;
  }

  /**
   * Returns a block number when the deposited contract was deployed
   * @returns block number
   */
  public async getDeploymentBlockByNetwork(): Promise<number> {
    const chainId = await this.providerService.getChainId();
    return getDeploymentBlockByNetwork(chainId);
  }

  /**
   * Gets node operators data from cache
   * @returns event group
   */
  public async getCachedEvents(): Promise<DepositEventsCache> {
    const cachedEventGroup = await this.cacheService.getCache();
    const deploymentBlock = await this.getDeploymentBlockByNetwork();

    return {
      ...cachedEventGroup,
      startBlock: Math.max(cachedEventGroup.startBlock, deploymentBlock),
      endBlock: Math.max(cachedEventGroup.endBlock, deploymentBlock),
    };
  }

  /**
   * Saves deposited events to cache
   */
  public async setCachedEvents(eventGroup: DepositEventGroup): Promise<void> {
    return await this.cacheService.setCache({
      ...eventGroup,
      version: APP_VERSION,
    });
  }

  /**
   * Delete deposited events cache
   */
  public async deleteCachedEvents(): Promise<void> {
    return await this.cacheService.deleteCache();
  }

  /**
   * Returns events in the block range
   * If the request failed, it tries to repeat it or split it into two
   * @param startBlock - start of the range
   * @param endBlock - end of the range
   * @returns event group
   */
  public async fetchEventsFallOver(
    startBlock: number,
    endBlock: number,
  ): Promise<DepositEventGroup> {
    try {
      return await this.fetchEvents(startBlock, endBlock);
    } catch (error: any) {
      const isLimitExceeded = error?.error?.code === ERROR_LIMIT_EXCEEDED;
      const isTimeout = error?.code === 'TIMEOUT';
      const isPartitionRequired = isTimeout || isLimitExceeded;

      const isPartitionable = endBlock - startBlock > 1;

      if (isPartitionable && isPartitionRequired) {
        this.logger.debug?.(`Limit exceeded, try to split the chunk`, {
          startBlock,
          endBlock,
        });

        const center = Math.ceil((endBlock + startBlock) / 2);
        const [first, second] = await Promise.all([
          this.fetchEventsFallOver(startBlock, center - 1),
          this.fetchEventsFallOver(center, endBlock),
        ]);

        const events = first.events.concat(second.events);

        return { events, startBlock, endBlock };
      } else {
        this.logger.warn('Fetch error. Retry', error);

        await sleep(DEPOSIT_EVENTS_RETRY_TIMEOUT_MS);
        return await this.fetchEventsFallOver(startBlock, endBlock);
      }
    }
  }

  /**
   * Returns events in the block range
   * @param startBlock - start of the range
   * @param endBlock - end of the range
   * @returns event group
   */
  public async fetchEvents(
    startBlock: number,
    endBlock: number,
  ): Promise<DepositEventGroup> {
    const contract = await this.getContract();
    const filter = contract.filters.DepositEvent();
    const rawEvents = await contract.queryFilter(filter, startBlock, endBlock);
    const events = rawEvents.map((rawEvent) => this.formatEvent(rawEvent));

    return { events, startBlock, endBlock };
  }

  /**
   * Updates the cache deposited events
   * The last N blocks are not stored, in order to avoid storing reorganized blocks
   */
  public async updateEventsCache(): Promise<void> {
    const fetchTimeStart = performance.now();

    const [currentBlock, initialCache] = await Promise.all([
      this.providerService.getBlockNumber(),
      this.getCachedEvents(),
    ]);

    const eventGroup = { ...initialCache };
    const firstNotCachedBlock = initialCache.endBlock + 1;
    const toBlock = currentBlock - DEPOSIT_EVENTS_CACHE_LAG_BLOCKS;

    for (
      let block = firstNotCachedBlock;
      block <= toBlock;
      block += DEPOSIT_EVENTS_STEP
    ) {
      const chunkStartBlock = block;
      const chunkToBlock = Math.min(toBlock, block + DEPOSIT_EVENTS_STEP - 1);

      const chunkEventGroup = await this.fetchEventsFallOver(
        chunkStartBlock,
        chunkToBlock,
      );

      eventGroup.endBlock = chunkEventGroup.endBlock;
      eventGroup.events = eventGroup.events.concat(chunkEventGroup.events);

      this.logger.log('Historical events are fetched', {
        toBlock,
        startBlock: chunkStartBlock,
        endBlock: chunkToBlock,
        events: eventGroup.events.length,
      });

      await this.setCachedEvents(eventGroup);
    }

    const totalEvents = eventGroup.events.length;
    const newEvents = totalEvents - initialCache.events.length;

    const fetchTimeEnd = performance.now();
    const fetchTime = Math.ceil(fetchTimeEnd - fetchTimeStart) / 1000;

    // TODO: replace timer with metric

    this.logger.log('Deposit events cache is updated', {
      newEvents,
      totalEvents,
      fetchTime,
    });
  }

  /**
   * Returns all deposited events based on cache and fresh data
   */
  public async getAllDepositedEvents(
    blockNumber: number,
  ): Promise<DepositEventGroup> {
    const endBlock = blockNumber;
    const cachedEvents = await this.getCachedEvents();

    const firstNotCachedBlock = cachedEvents.endBlock + 1;
    const freshEvents = await this.fetchEventsFallOver(
      firstNotCachedBlock,
      endBlock,
    );

    const events = freshEvents.events.length;
    this.logger.debug?.('Fresh events are fetched', {
      startBlock: firstNotCachedBlock,
      endBlock,
      events,
    });

    const mergedEvents = cachedEvents.events.concat(freshEvents.events);

    return {
      events: mergedEvents,
      startBlock: cachedEvents.startBlock,
      endBlock,
    };
  }

  /**
   * Returns a deposit root
   */
  public async getDepositRoot(blockTag?: BlockTag): Promise<string> {
    return '';
  }
}
