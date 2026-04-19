import winston from 'winston';

const LEVEL = process.env.LOG_LEVEL ?? 'info';

export function createLogger(scope: string): winston.Logger {
  return winston.createLogger({
    level: LEVEL,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${scope}] ${level}: ${message}${metaStr}`;
      }),
    ),
    transports: [new winston.transports.Console()],
  });
}
