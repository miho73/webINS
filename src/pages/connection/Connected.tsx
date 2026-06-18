import {useEffect, useRef, useState} from "react";
import {AnimatePresence, motion} from "framer-motion";
import {CircuitBoard, Compass, Play, Power, RotateCcw} from "lucide-react";

import {Button} from "@/components/ui/button.tsx";
import {SensorScene} from "@/components/SensorScene.tsx";
import serial from "@/core/Serial.ts";

type ConnectedProps = {
    onDisconnected?(): void;
};

type Vector3Value = {
    x: number;
    y: number;
    z: number;
};

type DevicePhase = "connected" | "needsAlign" | "aligning" | "standby" | "starting" | "streaming" | "fault";

const ZERO_VECTOR = {x: 0, y: 0, z: 0};

const STATUS_LABELS: Record<string, string> = {
    WAITING: "연결 대기",
    ALIGNING: "정렬중",
    STANDBY: "대기중",
    READY: "측정 준비",
    MOVING: "측정중",
};

export function Connected({onDisconnected}: ConnectedProps) {
    const metadata = serial.deviceMetadata;
    const [currentStatus, setCurrentStatus] = useState("연결됨");
    const [devicePhase, setDevicePhase] = useState<DevicePhase>("connected");
    const [gravity, setGravity] = useState<number | null>(null);
    const [isAligning, setIsAligning] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [lastLine, setLastLine] = useState("대기");
    const [linearAcceleration, setLinearAcceleration] = useState<Vector3Value>(ZERO_VECTOR);
    const [orientationAngles, setOrientationAngles] = useState<Vector3Value>(ZERO_VECTOR);
    const isWaitingForAlignmentStandbyRef = useRef(false);

    function applyStatusLine(line: string) {
        const payload = line.replace("STATUS:", "");
        const statusName = payload.split(",")[0];

        setCurrentStatus(STATUS_LABELS[statusName] ?? payload);

        if (statusName === "WAITING") {
            setDevicePhase("connected");
            setIsAligning(false);
            setIsStreaming(false);
            setLastLine("INS WAITING");
            return;
        }

        if (statusName === "ALIGNING") {
            setDevicePhase("aligning");
            setIsAligning(true);
            setIsStreaming(false);
            setLastLine("INS ALIGNING");
            return;
        }

        if (statusName === "STANDBY") {
            const gravityMatch = line.match(/G:([-+]?\d+(?:\.\d+)?)/);
            const isAlignmentStandby = isWaitingForAlignmentStandbyRef.current;

            isWaitingForAlignmentStandbyRef.current = false;
            setDevicePhase(isAlignmentStandby ? "standby" : "needsAlign");
            setCurrentStatus(isAlignmentStandby ? "대기중" : "정렬 필요");
            setIsAligning(false);
            setIsStreaming(false);
            setLastLine(isAlignmentStandby ? "INS STBY" : "INS STBY / ALIGN RQRD");

            if (isAlignmentStandby && gravityMatch) {
                setGravity(Number(gravityMatch[1]));
            }

            return;
        }

        if (statusName === "READY" || statusName === "MOVING") {
            setDevicePhase("streaming");
            setIsAligning(false);
            setIsStreaming(true);
            setLastLine(statusName === "READY" ? "INS READY" : "INS MOVING");
        }
    }

    useEffect(() => {
        return serial.subscribe((line) => {
            if (line.startsWith("STATUS:")) {
                applyStatusLine(line);
            }

            const vectors = parseSensorLine(line);

            if (vectors.linear) {
                setLinearAcceleration(vectors.linear);
            }

            if (vectors.orientation) {
                setOrientationAngles(vectors.orientation);
            }
        });
    }, []);

    async function disconnect() {
        await serial.disconnect();
        onDisconnected?.();
    }

    async function align() {
        isWaitingForAlignmentStandbyRef.current = false;
        setDevicePhase("aligning");
        setIsAligning(true);
        setCurrentStatus("정렬중");
        setLastLine("ALIGN REQUESTED");

        try {
            await serial.writeLine("ALIGN");

            const aligning = await serial.waitForLine((line) => line === "STATUS:ALIGNING", 3000);

            if (!aligning) {
                isWaitingForAlignmentStandbyRef.current = false;
                setDevicePhase("fault");
                setCurrentStatus("정렬 실패");
                setLastLine("ALIGN BEGIN TIMEOUT");
                setIsAligning(false);
                return;
            }

            setCurrentStatus("정렬중");
            isWaitingForAlignmentStandbyRef.current = true;

            const standby = await serial.waitForLine((line) => line.startsWith("STATUS:STANDBY"), 12000);

            if (!standby) {
                isWaitingForAlignmentStandbyRef.current = false;
                setDevicePhase("fault");
                setCurrentStatus("정렬 실패");
                setLastLine("ALIGN COMPLETE TIMEOUT");
                setIsAligning(false);
                return;
            }

            const gravityMatch = standby.match(/G:([-+]?\d+(?:\.\d+)?)/);

            if (gravityMatch) {
                setGravity(Number(gravityMatch[1]));
            }

            setDevicePhase("standby");
            setCurrentStatus("대기중");
            setLastLine("INS STANDBY");
            setIsAligning(false);
        } catch {
            setDevicePhase("fault");
            setCurrentStatus("정렬 실패");
            setLastLine("INS FAULT");
            setIsAligning(false);
        }
    }

    async function startMeasurement() {
        isWaitingForAlignmentStandbyRef.current = false;
        setDevicePhase("starting");
        setCurrentStatus("START REQUESTED");
        setLastLine("START");

        try {
            await serial.writeLine("START");
        } catch {
            setDevicePhase("fault");
            setCurrentStatus("시작 실패");
            setLastLine("START WRITE FAILED");
        }
    }

    async function resetMeasurement() {
        try {
            isWaitingForAlignmentStandbyRef.current = false;
            setDevicePhase("needsAlign");
            setCurrentStatus("정렬 필요");
            setLastLine("STOP / ALIGN REQUIRED");
            setGravity(null);
            setIsStreaming(false);
            setLinearAcceleration(ZERO_VECTOR);
            setOrientationAngles(ZERO_VECTOR);
            await serial.writeLine("STOP");
        } catch {
            setDevicePhase("fault");
            setCurrentStatus("리셋 실패");
            setLastLine("STOP WRITE FAILED");
        }
    }

    const deviceInfo = [
        ["장비 이름", metadata.deviceName ?? "알 수 없음"],
        ["전송 속도", metadata.baudRate === null ? "알 수 없음" : `${metadata.baudRate} baud`],
        ["펌웨어", metadata.firmwareVersion ?? "알 수 없음"],
        ["중력가속도", gravity === null ? "대기" : `${gravity.toFixed(4)} m/s²`],
    ];
    const isReadyToStart = devicePhase === "standby";
    const isMeasurementActive = devicePhase === "streaming" || isStreaming;
    const isStartPending = devicePhase === "starting";

    return (
        <section className="grid h-full min-h-0 gap-5 lg:grid-cols-[340px_1fr]">
            <motion.aside
                className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-4"
                initial={{opacity: 0, x: -16}}
                animate={{opacity: 1, x: 0}}
                transition={{duration: 0.45, ease: "easeOut"}}
            >
                <div className="border border-white/10 bg-white/3 p-5">
                    <div className="mb-5 flex size-11 items-center justify-center rounded-md bg-white text-black">
                        <CircuitBoard className="size-5"/>
                    </div>
                    <p className="text-sm font-semibold tracking-[0.24em] text-white/45 uppercase">
                        Connected device
                    </p>
                    <h1 className="mt-2 text-3xl font-semibold leading-tight text-white">
                        가속도계 상태
                    </h1>
                    <div className="mt-5 border border-white/10 bg-black/50 px-4 py-4">
                        <p className="text-xs font-semibold tracking-[0.2em] text-white/40 uppercase">
                            Current status
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-white">{currentStatus}</p>
                        <p className="mt-2 break-all text-xs leading-5 text-white/45">{lastLine}</p>
                    </div>
                </div>

                <div className="grid gap-3">
                    <motion.div
                        layout
                        className={isReadyToStart ? "grid grid-cols-2 gap-3" : "grid grid-cols-1 gap-3"}
                        transition={{layout: {duration: 0.24, ease: "easeOut"}}}
                    >
                        <AnimatePresence initial={false} mode="popLayout">
                            {isMeasurementActive && (
                                <motion.div
                                    key="reset"
                                    layout
                                    initial={{opacity: 0, scale: 0.98}}
                                    animate={{opacity: 1, scale: 1}}
                                    exit={{opacity: 0, scale: 0.98}}
                                    transition={{duration: 0.18, ease: "easeOut"}}
                                >
                                    <Button
                                        className="h-11 w-full bg-white text-black hover:bg-white/90"
                                        onClick={resetMeasurement}
                                    >
                                        <RotateCcw className="size-4"/>
                                        리셋
                                    </Button>
                                </motion.div>
                            )}

                            {isReadyToStart && (
                                <motion.div
                                    key="start"
                                    layout
                                    initial={{opacity: 0, x: -8}}
                                    animate={{opacity: 1, x: 0}}
                                    exit={{opacity: 0, x: -12}}
                                    transition={{duration: 0.18, ease: "easeOut"}}
                                >
                                    <Button
                                        className="h-11 w-full bg-white text-black hover:bg-white/90"
                                        onClick={startMeasurement}
                                    >
                                        <Play className="size-4"/>
                                        시작
                                    </Button>
                                </motion.div>
                            )}

                            {!isMeasurementActive && !isStartPending && (
                                <motion.div
                                    key="align"
                                    layout
                                    initial={{opacity: 0, scale: 0.98}}
                                    animate={{opacity: 1, scale: 1}}
                                    exit={{opacity: 0, scale: 0.98}}
                                    transition={{duration: 0.18, ease: "easeOut"}}
                                >
                                    <Button
                                        className={[
                                            "h-11 w-full transition-colors duration-200",
                                            isReadyToStart
                                                ? "border-white/20 bg-white/5 text-white hover:bg-white hover:text-black"
                                                : "bg-white text-black hover:bg-white/90",
                                        ].join(" ")}
                                        variant={isReadyToStart ? "outline" : "default"}
                                        disabled={isAligning}
                                        onClick={align}
                                    >
                                        <Compass className="size-4"/>
                                        {isAligning ? "정렬중" : isReadyToStart ? "정렬" : "정렬 시작"}
                                    </Button>
                                </motion.div>
                            )}

                            {isStartPending && (
                                <motion.div
                                    key="pending"
                                    layout
                                    initial={{opacity: 0, scale: 0.98}}
                                    animate={{opacity: 1, scale: 1}}
                                    exit={{opacity: 0, scale: 0.98}}
                                    transition={{duration: 0.18, ease: "easeOut"}}
                                >
                                    <Button
                                        className="h-11 w-full bg-white/70 text-black"
                                        disabled
                                    >
                                        <Play className="size-4"/>
                                        시작 요청중
                                    </Button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                    <Button
                        className="h-11 bg-rose-600/60 text-white transition-colors duration-200 hover:bg-rose-600/75"
                        variant="outline"
                        onClick={disconnect}
                    >
                        <Power className="size-4"/>
                        연결 해제
                    </Button>
                </div>

                <div className="grid content-start gap-3">
                    {deviceInfo.map(([label, value]) => (
                        <InfoRow key={label} label={label} value={value}/>
                    ))}
                </div>
            </motion.aside>

            <motion.div
                className="grid min-h-0 grid-rows-[1fr_auto] gap-4"
                initial={{opacity: 0, y: 14}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.45, delay: 0.06, ease: "easeOut"}}
            >
                <div className="min-h-0 overflow-hidden border border-white/10 bg-white/3">
                    <SensorScene
                        linearAcceleration={linearAcceleration}
                        orientationAngles={orientationAngles}
                    />
                </div>

                <div className="grid gap-3">
                    <VectorPanel
                        title="선가속도"
                        unit="m/s²"
                        value={linearAcceleration}
                    />
                </div>
            </motion.div>
        </section>
    );
}

function parseSensorLine(line: string): {linear: Vector3Value | null; orientation: Vector3Value | null} {
    const csvMatch = line.match(/^([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)$/);

    if (csvMatch) {
        return {
            linear: {
                x: Number(csvMatch[1]),
                y: Number(csvMatch[2]),
                z: Number(csvMatch[3]),
            },
            orientation: null,
        };
    }

    const linear = parseVectorSection(line, "ACC");
    const orientation = parseVectorSection(line, "ROT");

    return {linear, orientation};
}

function parseVectorSection(line: string, sectionName: string): Vector3Value | null {
    const section = line.split("/").find((part) => part.startsWith(`${sectionName}:`));

    if (!section) {
        return null;
    }

    const values = section
        .slice(`${sectionName}:`.length)
        .split(",")
        .map((value) => Number(value));

    if (values.length !== 3 || values.some((value) => Number.isNaN(value))) {
        return null;
    }

    return {
        x: values[0],
        y: values[1],
        z: values[2],
    };
}

function InfoRow({label, value}: {label: string; value: string}) {
    return (
        <div className="flex items-center justify-between gap-5 border border-white/10 bg-white/3 px-4 py-3">
            <span className="shrink-0 text-sm text-white/45">{label}</span>
            <span className="break-all text-right text-sm font-semibold text-white">{value}</span>
        </div>
    );
}

function VectorPanel({title, unit, value}: {title: string; unit: string; value: Vector3Value}) {
    return (
        <div className="border border-white/10 bg-white/3 p-4">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-white">{title}</h2>
                <span className="text-sm text-white/45">{unit}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <AxisValue axis="X" color="text-red-300" value={value.x}/>
                <AxisValue axis="Y" color="text-green-300" value={value.y}/>
                <AxisValue axis="Z" color="text-blue-300" value={value.z}/>
            </div>
        </div>
    );
}

function AxisValue({axis, color, value}: {axis: string; color: string; value: number}) {
    return (
        <div className="border border-white/10 bg-black/40 px-3 py-2">
            <p className={`text-xs font-semibold ${color}`}>{axis}</p>
            <p className="mt-1 text-sm font-semibold text-white">{value.toFixed(3)}</p>
        </div>
    );
}
