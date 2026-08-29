export class Logger {
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    let msg = `[${timestamp}] [${this.serviceName}] [${level.toUpperCase()}]: ${message}`;
    if (meta) {
      msg += ` | ${JSON.stringify(meta)}`;
    }
    return msg;
  }

  info(message: string, meta?: any) {
    console.log(this.formatMessage('info', message, meta));
  }

  error(message: string, error?: any) {
    console.error(this.formatMessage('error', message, error));
  }

  warn(message: string, meta?: any) {
    console.warn(this.formatMessage('warn', message, meta));
  }

  debug(message: string, meta?: any) {
    console.debug(this.formatMessage('debug', message, meta));
  }
}
