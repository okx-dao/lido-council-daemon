import { hexZeroPad } from '@ethersproject/bytes';
import { Wallet } from '@ethersproject/wallet';
import { LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from 'common/config';
import { LoggerModule } from 'common/logger';
import { PrometheusModule } from 'common/prometheus';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { MockProviderModule } from 'provider';
import { ProviderService } from 'provider';
import { WalletModule } from 'wallet';
import { WALLET_PRIVATE_KEY } from './wallet.constants';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  const wallet = Wallet.createRandom();
  let walletService: WalletService;
  let providerService: ProviderService;
  let loggerService: LoggerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot(),
        MockProviderModule.forRoot(),
        LoggerModule,
        PrometheusModule,
        WalletModule,
      ],
    })
      .overrideProvider(WALLET_PRIVATE_KEY)
      .useValue(wallet.privateKey)
      .compile();

    walletService = moduleRef.get(WalletService);
    providerService = moduleRef.get(ProviderService);
    loggerService = moduleRef.get(WINSTON_MODULE_NEST_PROVIDER);

    jest.spyOn(loggerService, 'log').mockImplementation(() => undefined);
  });

  describe('subscribeToEthereumUpdates', () => {
    it('should subscribe to updates', () => {
      const mockOn = jest
        .spyOn(providerService.provider, 'on')
        .mockImplementation(() => undefined as any);

      walletService.subscribeToEthereumUpdates();
      expect(mockOn).toBeCalledTimes(1);
      expect(mockOn).toBeCalledWith('block', expect.any(Function));
    });
  });

  describe('wallet', () => {
    it('should return a wallet', async () => {
      expect(walletService.wallet).toBeInstanceOf(Wallet);
    });

    it('should cache instance', async () => {
      expect(walletService.wallet).toBe(walletService.wallet);
    });
  });

  describe('address', () => {
    it('should return correct address', async () => {
      expect(walletService.address).toBe(wallet.address);
    });
  });

  describe('signDepositData', () => {
    it('should sign deposit data', async () => {
      const prefix = hexZeroPad(
        '0x5f3774264799f2d397a5f1725c92e628dba9e6a5f02beb092ef8cae850b05001',
        32,
      );
      const depositRoot = hexZeroPad(
        '0xf551fb18d2bd952eed99e3a1f223cb125b64814c723592f5d3df1865b72f071b',
        32,
      );
      const indexs = [0, 1];
      const blockNumber = 42;
      const blockHash = hexZeroPad(
        '0xe6372e60d69db155b0fb55547023884cdab7e783a939f37e4fa7cc183b2cf0c3',
        32,
      );
      const signature = await walletService.signDepositData(
        prefix,
        blockNumber,
        blockHash,
        depositRoot,
        indexs,
      );

      expect(signature).toEqual(
        expect.objectContaining({
          _vs: expect.any(String),
          r: expect.any(String),
          s: expect.any(String),
          v: expect.any(Number),
        }),
      );
    });
  });

  describe('signPauseData', () => {
    it('should sign pause data', async () => {
      const prefix = hexZeroPad(
        '0x5f3774264799f2d397a5f1725c92e628dba9e6a5f02beb092ef8cae850b05001',
        32,
      );
      const blockNumber = 42;
      const signature = await walletService.signPauseData(
        prefix,
        blockNumber,
        1,
        0,
      );

      expect(signature).toEqual(
        expect.objectContaining({
          _vs: expect.any(String),
          r: expect.any(String),
          s: expect.any(String),
          v: expect.any(Number),
        }),
      );
    });
  });
});
