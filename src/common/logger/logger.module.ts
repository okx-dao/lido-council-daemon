import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { Configuration } from 'common/config';

export const LoggerModule = WinstonModule.forRootAsync({
  inject: [Configuration],
  useFactory: async (config: Configuration) => ({
    level: config.LOG_LEVEL,
    transports: [
      new winston.transports.Console({
        format:
          config.LOG_FORMAT === 'json'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.simple(),
              ),
      }),
    ],
  }),
});