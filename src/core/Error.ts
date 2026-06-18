import {v4 as uuidv4} from "uuid";

interface Record {
    timestamp: string;
    version: string;
    identifier: string;
    message: string;
    data: {
        [key: string]: string | number | boolean | string[] | number[] | null | undefined
    }
}

const uuid: string | null = null;
const VERSION = import.meta.env.VITE_APP_VERSION;
const log: Record[] = [];

function getUniqueId(): string {
    if (uuid) return uuid;

    const existingId = localStorage.getItem("identity");
    if (existingId) return existingId;

    const newUUID = uuidv4();
    localStorage.setItem("identity", newUUID);
    return newUUID;
}

function addError(
    message: string,
    data?: {
        [key: string]: string | number | boolean | string[] | number[] | null | undefined
    }
) {
    log.push({
        timestamp: new Date().toISOString(),
        version: VERSION,
        identifier: getUniqueId(),
        message: message,
        data: data ?? {}
    });
    console.error(`[${VERSION}] ${message}`);
    console.log(log);
}

export {
    addError, getUniqueId
};
