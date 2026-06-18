import {addError} from "@/core/Error.ts";

const BAUD_RATE = 115200;

const ConnectionResult = {
    OK: 0x0000,
    NOT_SUPPORTED: 0x1001,
    EXCEPTION: 0x1002,
    PONG_TIMEOUT: 0x1003,
    WAITING_TIMEOUT: 0x1004,
    OPEN_FAILED: 0x1005,
} as const;

const ConnectionStatus = {
    OFFLINE: 0x0,
    ONLINE: 0x1,
} as const;

type ConnectionResultCode = typeof ConnectionResult[keyof typeof ConnectionResult];
type ConnectionStatusCode = typeof ConnectionStatus[keyof typeof ConnectionStatus];
type LinePredicate = (line: string) => boolean;

type SerialPortLike = {
    close(): Promise<void>;
    open(options: { baudRate: number }): Promise<void>;
    getInfo(): { usbVendorId?: number; usbProductId?: number };
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
};

type SerialNavigator = Navigator & {
    serial?: {
        requestPort(): Promise<SerialPortLike>;
    };
};

type LineWaiter = {
    predicate: LinePredicate;
    resolve(line: string | null): void;
    timeoutId: number;
};

type LineListener = (line: string) => void;

type SerialLogDirection = "TX" | "RX";

type SerialLogRecord = {
    direction: SerialLogDirection;
    message: string;
    timestamp: string;
};

type SerialLogListener = (records: SerialLogRecord[]) => void;

type DeviceMetadata = {
    baudRate: string | null;
    deviceName: string | null;
    firmwareVersion: string | null;
    raw: string | null;
};

class Serial {
    connectionStatus: ConnectionStatusCode;
    deviceMetadata: DeviceMetadata;

    private decoder = new TextDecoder();
    private encoder = new TextEncoder();
    private lineBuffer = "";
    private port: SerialPortLike | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private recentLines: string[] = [];
    private serialLog: SerialLogRecord[] = [];
    private serialLogListeners = new Set<SerialLogListener>();
    private lineListeners = new Set<LineListener>();
    private waiters: LineWaiter[] = [];
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

    constructor() {
        this.connectionStatus = ConnectionStatus.OFFLINE;
        this.deviceMetadata = {
            baudRate: null,
            deviceName: null,
            firmwareVersion: null,
            raw: null,
        };
    }

    async connect(): Promise<ConnectionResultCode> {
        try {
            const serialNavigator = navigator as SerialNavigator;

            if (!serialNavigator.serial) {
                this.connectionStatus = ConnectionStatus.OFFLINE;
                return ConnectionResult.NOT_SUPPORTED;
            }

            if (!this.port) {
                this.port = await serialNavigator.serial.requestPort();
                const info = this.port.getInfo();
                console.log(info.usbVendorId, " ", info.usbProductId);
            }

            if (!this.isPortOpen()) {
                try {
                    await this.port.open({baudRate: BAUD_RATE});
                } catch (error) {
                    console.error("[Serial] Failed to open port", error);
                    await this.resetPort();
                    this.connectionStatus = ConnectionStatus.OFFLINE;
                    return ConnectionResult.OPEN_FAILED;
                }
            }

            if (!this.reader) {
                this.startReadLoop();
            }

            await this.waitForLine((line) => line.startsWith("META:VERSION:"), 5000);

            const waiting = await this.waitForLine((line) => line === "STATUS:WAITING", 5000);

            if (!waiting) {
                this.connectionStatus = ConnectionStatus.OFFLINE;
                return ConnectionResult.WAITING_TIMEOUT;
            }

            await this.writeLine("PING");

            const pong = await this.waitForLine((line) => line === "PONG", 10000);

            if (!pong) {
                this.connectionStatus = ConnectionStatus.OFFLINE;
                return ConnectionResult.PONG_TIMEOUT;
            }

            this.connectionStatus = ConnectionStatus.ONLINE;
            return ConnectionResult.OK;
        } catch (e) {
            this.connectionStatus = ConnectionStatus.OFFLINE;
            await this.resetPort();
            console.error(e);
            addError("Arduino connection failure: exception thrown");
            return ConnectionResult.EXCEPTION;
        }
    }

    async disconnect(): Promise<void> {
        this.connectionStatus = ConnectionStatus.OFFLINE;
        await this.resetPort({clearMetadata: true});
    }

    async writeLine(message: string): Promise<void> {
        if (!this.port?.writable) {
            throw new Error("Serial port is not writable");
        }

        if (!this.writer) {
            this.writer = this.port.writable.getWriter();
        }

        this.addSerialLog("TX", message);

        await this.writer.write(this.encoder.encode(`${message}\n`));
    }

    waitForLine(predicate: LinePredicate, timeoutMs: number): Promise<string | null> {
        const existingLineIndex = this.recentLines.findIndex(predicate);

        if (existingLineIndex >= 0) {
            const [line] = this.recentLines.splice(existingLineIndex, 1);
            return Promise.resolve(line);
        }

        return new Promise((resolve) => {
            const waiter: LineWaiter = {
                predicate,
                resolve,
                timeoutId: window.setTimeout(() => {
                    this.waiters = this.waiters.filter((item) => item !== waiter);
                    resolve(null);
                }, timeoutMs),
            };

            this.waiters.push(waiter);
        });
    }

    subscribe(listener: LineListener): () => void {
        this.lineListeners.add(listener);

        return () => {
            this.lineListeners.delete(listener);
        };
    }

    subscribeLog(listener: SerialLogListener): () => void {
        this.serialLogListeners.add(listener);
        listener(this.getSerialLog());

        return () => {
            this.serialLogListeners.delete(listener);
        };
    }

    getSerialLog(): SerialLogRecord[] {
        return [...this.serialLog];
    }

    private startReadLoop() {
        if (!this.port?.readable || this.reader) {
            return;
        }

        this.reader = this.port.readable.getReader();

        void this.readLoop();
    }

    private isPortOpen() {
        return Boolean(this.port?.readable && this.port?.writable);
    }

    private resetDeviceMetadata() {
        this.deviceMetadata = {
            baudRate: null,
            deviceName: null,
            firmwareVersion: null,
            raw: null,
        };
    }

    private async resetPort(options: { clearMetadata?: boolean } = {}) {
        this.waiters.forEach((waiter) => {
            window.clearTimeout(waiter.timeoutId);
            waiter.resolve(null);
        });
        this.waiters = [];
        this.recentLines = [];
        this.lineBuffer = "";

        if (this.writer) {
            this.writer.releaseLock();
            this.writer = null;
        }

        if (this.reader) {
            await this.reader.cancel().catch(() => undefined);
            this.reader = null;
        }

        if (this.port && this.isPortOpen()) {
            await this.port.close().catch(() => undefined);
        }

        this.port = null;

        if (options.clearMetadata) {
            this.resetDeviceMetadata();
        }
    }

    private async readLoop() {
        const reader = this.reader;

        if (!reader) {
            return;
        }

        try {
            while (true) {
                const {value, done} = await reader.read();

                if (done) {
                    break;
                }

                if (value) {
                    this.consumeChunk(value);
                }
            }
        } catch {
            addError("Arduino serial read failure");
        } finally {
            reader.releaseLock();

            if (this.reader === reader) {
                this.reader = null;
            }

            this.connectionStatus = ConnectionStatus.OFFLINE;
        }
    }

    private consumeChunk(value: Uint8Array) {
        this.lineBuffer += this.decoder.decode(value, {stream: true});

        while (this.lineBuffer.includes("\n")) {
            const lineEnd = this.lineBuffer.indexOf("\n");
            const line = this.lineBuffer.slice(0, lineEnd).trim();
            this.lineBuffer = this.lineBuffer.slice(lineEnd + 1);

            if (line) {
                if (line.startsWith("ACC")) {
                    console.log("[Serial RX]", line);
                } else {
                    this.addSerialLog("RX", line);
                }

                this.parseDeviceMetadata(line);
                this.lineListeners.forEach((listener) => listener(line));
                this.resolveLine(line);
            }
        }
    }

    private parseDeviceMetadata(line: string) {
        if (!line.startsWith("META:VERSION:")) {
            return;
        }

        const metadataLine = line.slice("META:".length);
        const metadata = metadataLine.split("/").reduce<Record<string, string>>((result, part) => {
            const separatorIndex = part.indexOf(":");

            if (separatorIndex < 0) {
                return result;
            }

            const key = part.slice(0, separatorIndex);
            const value = part.slice(separatorIndex + 1);

            return {
                ...result,
                [key]: value,
            };
        }, {});

        this.deviceMetadata = {
            baudRate: metadata.BAUD ?? null,
            deviceName: metadata.DEV?.replaceAll("_", " ") ?? null,
            firmwareVersion: metadata.VERSION ?? null,
            raw: line,
        };
    }

    private resolveLine(line: string) {
        const waiter = this.waiters.find((item) => item.predicate(line));

        if (!waiter) {
            this.recentLines.push(line);
            this.recentLines = this.recentLines.slice(-20);
            return;
        }

        window.clearTimeout(waiter.timeoutId);
        this.waiters = this.waiters.filter((item) => item !== waiter);
        waiter.resolve(line);
    }

    private addSerialLog(direction: SerialLogDirection, message: string) {
        const record = {
            direction,
            message,
            timestamp: new Date().toISOString(),
        };

        this.serialLog = [...this.serialLog, record].slice(-300);
        console.log(`[Serial ${direction}]`, message);
        this.serialLogListeners.forEach((listener) => listener(this.getSerialLog()));
    }
}

const serial = new Serial();

export default serial;
export {
    ConnectionResult,
    ConnectionStatus,
};
export type {
    DeviceMetadata,
    ConnectionResultCode,
    ConnectionStatusCode,
    LineListener,
    SerialLogRecord,
};
