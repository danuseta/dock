export class Logger {
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  info(message: string, ...meta: any[]) {
    console.log(`[${new Date().toISOString()}] [INFO] [${this.serviceName}]: ${message}`, ...meta);
  }

  error(message: string, ...meta: any[]) {
    console.error(`[${new Date().toISOString()}] [ERROR] [${this.serviceName}]: ${message}`, ...meta);
  }

  warn(message: string, ...meta: any[]) {
    console.warn(`[${new Date().toISOString()}] [WARN] [${this.serviceName}]: ${message}`, ...meta);
  }
}
