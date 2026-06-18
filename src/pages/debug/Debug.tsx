import {useEffect, useState} from "react";
import {motion} from "framer-motion";
import {ArrowLeftToLine, ArrowRightFromLine, PowerOff, RefreshCw, ServerCrash} from "lucide-react";

import {Button} from "@/components/ui/button.tsx";
import {getUniqueId} from "@/core/Error.ts";
import serial, {ConnectionStatus} from "@/core/Serial.ts";
import type {SerialLogRecord} from "@/core/Serial.ts";

export function Debug() {
    const [, setRefreshKey] = useState(0);
    const [serialLog, setSerialLog] = useState<SerialLogRecord[]>(() => serial.getSerialLog());
    const teamUuid = getUniqueId();
    const rootDomain = (import.meta.env.VITE_ROOT_DOMAIN ?? window.location.origin).replace(/\/$/, "");
    const teamDebugUrl = `${rootDomain}/debug/team/${teamUuid}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(teamDebugUrl)}`;
    const isDeviceConnected = serial.connectionStatus === ConnectionStatus.ONLINE;
    const metadata = serial.deviceMetadata;
    const deviceName = metadata.deviceName ?? "이름 정보 없음";
    const baudRate = metadata.baudRate === null ? "전송속도 정보 없음" : `${metadata.baudRate} baud`;
    const firmwareVersion = metadata.firmwareVersion ?? "펌웨어 정보 없음";

    useEffect(() => {
        return serial.subscribeLog(setSerialLog);
    }, []);

    async function forceDisconnect() {
        await serial.disconnect();
        setRefreshKey((key) => key + 1);
    }

    function reloadBrowser() {
        window.location.reload();
    }

    return (
        <section className="grid gap-5 pb-6">
            <motion.div
                className="flex flex-col justify-between border border-white/10 bg-white/3 p-6"
                initial={{opacity: 0, x: -16}}
                animate={{opacity: 1, x: 0}}
                transition={{duration: 0.45, ease: "easeOut"}}
            >
                <div>
                    <div className="mb-6 flex size-12 items-center justify-center rounded-md bg-white text-black">
                        <ServerCrash className="size-6"/>
                    </div>
                    <p className="mb-3 text-sm font-semibold tracking-[0.24em] text-white/45 uppercase">
                        Troubleshooting
                    </p>
                    <h1 className="text-4xl font-semibold leading-tight text-white">webINS 디버그</h1>
                </div>
            </motion.div>

            <motion.div
                className="grid gap-5"
                initial={{opacity: 0, y: 14}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.45, delay: 0.06, ease: "easeOut"}}
            >
                <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
                    <div className="border border-white/10 bg-white/3 p-5">
                        <p className="text-sm font-semibold tracking-[0.18em] text-white/45 uppercase">Team QR</p>
                        <div className="mt-4 bg-white p-3">
                            <img
                                alt="조 UUID 디버그 페이지 QR 코드"
                                className="mx-auto size-55"
                                src={qrImageUrl}
                            />
                        </div>
                    </div>

                    <div className="grid content-start gap-3">
                        <InfoRow label="조 UUID" value={teamUuid.toUpperCase()}/>
                        <InfoRow label="장치 연결" value={isDeviceConnected ? "Y" : "N"}/>
                        <InfoRow label="장치 이름" value={isDeviceConnected ? deviceName : "연결된 장치 없음"}/>
                        <InfoRow label="전송속도" value={isDeviceConnected ? baudRate : "연결된 장치 없음"}/>
                        <InfoRow label="보드 펌웨어 버전" value={isDeviceConnected ? firmwareVersion : "연결된 장치 없음"}/>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <Button
                                className="h-11 border-red-400/50 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                                variant="outline"
                                onClick={forceDisconnect}
                            >
                                <PowerOff className="size-4"/>
                                강제 장치 연결 해제
                            </Button>
                            <Button
                                className="h-11 border-white/20 bg-white/5 text-white hover:bg-white hover:text-black"
                                variant="outline"
                                onClick={reloadBrowser}
                            >
                                <RefreshCw className="size-4"/>
                                브라우저 새로고침
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="border border-white/10 bg-black/50 p-5">
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-base font-semibold tracking-[0.18em] text-white/45 uppercase">Serial log</p>
                        <span className="text-sm text-white/35">{serialLog.length} records</span>
                    </div>
                    <div className="max-h-96 overflow-y-auto border border-white/10 bg-black/60 p-4">
                        {serialLog.length === 0 ? (
                            <p className="text-sm text-white/35">전송/수신 기록 없음</p>
                        ) : (
                            <div className="grid gap-2">
                                {serialLog.slice().reverse().map((record, index) => (
                                    <SerialLogRow
                                        key={`${record.timestamp}-${index}`}
                                        record={record}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </motion.div>
        </section>
    );
}

function SerialLogRow({record}: {record: SerialLogRecord}) {
    const isTx = record.direction === "TX";

    return (
        <div className="grid gap-2 border border-white/10 bg-white/3 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <div className={"flex justify-baseline items-center gap-2"}>
                    <span className={isTx ? "text-base font-semibold text-blue-300" : "text-base font-semibold text-green-300"}>{record.direction}</span>
                    {record.direction == "RX" && <ArrowRightFromLine className={"size-5"}/> }
                    {record.direction == "TX" && <ArrowLeftToLine className={"size-5"}/> }
                </div>
                <span className="text-sm text-white/35">
                    {formatTimestamp(record.timestamp)}
                </span>
            </div>
            <p className="break-all text-base leading-6 text-white/75">{record.message}</p>
        </div>
    );
}

function formatTimestamp(timestamp: string) {
    const date = new Date(timestamp);
    const year = String(date.getFullYear());
    const month = pad(date.getMonth() + 1, 2);
    const day = pad(date.getDate(), 2);
    const hours = pad(date.getHours(), 2);
    const minutes = pad(date.getMinutes(), 2);
    const seconds = pad(date.getSeconds(), 2);
    const milliseconds = pad(date.getMilliseconds(), 3);

    return `${year}.${month}.${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function pad(value: number, length: number) {
    return String(value).padStart(length, "0");
}

function InfoRow({label, value}: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-5 border border-white/10 bg-white/3 px-5 py-4">
            <span className="shrink-0 text-sm text-white/45">{label}</span>
            <span className="break-all text-right text-sm font-semibold text-white">{value}</span>
        </div>
    );
}
