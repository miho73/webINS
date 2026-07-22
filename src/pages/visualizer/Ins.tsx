import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import type {PointerEvent as ReactPointerEvent} from "react";
import {motion} from "framer-motion";
import {Compass, LocateFixed, Play, RotateCcw, RotateCw, Square} from "lucide-react";

import {Button} from "@/components/ui/button.tsx";
import serial from "@/core/Serial.ts";

type Vector2Value = {
    x: number;
    y: number;
};

type Vector3Value = Vector2Value & {
    z: number;
};

type InsPhase = "idle" | "aligning" | "standby" | "starting" | "moving" | "completed" | "fault";

type NavigationSample = {
    acceleration: Vector2Value;
    position: Vector2Value;
    timeSeconds: number;
    timestamp: number;
    velocity: Vector2Value;
};

type RawNavigationSample = {
    acceleration: Vector3Value;
    dt: number;
    timeSeconds: number;
    timestamp: number;
};

type PathHoverPoint = {
    distance: number;
    viewX: number;
    viewY: number;
};

const MAX_NAVIGATION_SAMPLES = 900;
const MAP_SIZE = 1000;
const MAP_CENTER = MAP_SIZE / 2;
const MAP_PADDING_RATIO = 0.42;
const DEFAULT_GRID_METERS = 0.05;
const HOVER_HIT_RADIUS = 40;

export function Ins() {
    const [phase, setPhase] = useState<InsPhase>("idle");
    const [statusLabel, setStatusLabel] = useState("정렬 필요");
    const [lastResponse, setLastResponse] = useState("대기");
    const [planeRotationDegrees, setPlaneRotationDegrees] = useState(0);
    const [rawSamples, setRawSamples] = useState<RawNavigationSample[]>([]);
    const waitingForAlignmentStandbyRef = useRef(false);
    const movementStartAtRef = useRef<number | null>(null);
    const isMeasurementStoppedRef = useRef(false);
    const lastSampleAtRef = useRef<number | null>(null);

    const resetNavigationState = useCallback(() => {
        movementStartAtRef.current = null;
        isMeasurementStoppedRef.current = false;
        lastSampleAtRef.current = null;
        setRawSamples([]);
    }, []);

    const applyStatusLine = useCallback((line: string, receivedAt: number) => {
        const payload = line.replace("STATUS:", "");
        const statusName = payload.split(",")[0];

        setLastResponse(line);

        if (statusName === "ALIGNING") {
            setPhase("aligning");
            setStatusLabel("정렬중");
            return;
        }

        if (statusName === "STANDBY") {
            const isAlignmentStandby = waitingForAlignmentStandbyRef.current;

            waitingForAlignmentStandbyRef.current = false;
            setPhase(isAlignmentStandby ? "standby" : "idle");
            setStatusLabel(isAlignmentStandby ? "정렬 완료" : "정렬 필요");

            if (isAlignmentStandby) {
                resetNavigationState();
            }

            return;
        }

        if (statusName === "READY") {
            if (isMeasurementStoppedRef.current) {
                return;
            }

            setPhase("starting");
            setStatusLabel("측정 준비");
            return;
        }

        if (statusName === "MOVING") {
            if (isMeasurementStoppedRef.current) {
                return;
            }

            if (movementStartAtRef.current === null) {
                movementStartAtRef.current = receivedAt;
                lastSampleAtRef.current = null;
                setRawSamples([]);
            }

            setPhase("moving");
            setStatusLabel("이동중");
        }
    }, [resetNavigationState]);

    useEffect(() => {
        return serial.subscribe((line) => {
            const receivedAt = Date.now();

            if (line.startsWith("STATUS:")) {
                applyStatusLine(line, receivedAt);
            }

            const acceleration = parseAcceleration(line);

            if (!acceleration || movementStartAtRef.current === null || isMeasurementStoppedRef.current) {
                return;
            }

            const timeSeconds = (receivedAt - movementStartAtRef.current) / 1000;
            const lastSampleAt = lastSampleAtRef.current;
            const dt = lastSampleAt === null ? 0 : Math.max(0, (receivedAt - lastSampleAt) / 1000);

            lastSampleAtRef.current = receivedAt;

            setRawSamples((items) => [
                ...items,
                {
                    acceleration,
                    dt,
                    timeSeconds,
                    timestamp: receivedAt,
                },
            ].slice(-MAX_NAVIGATION_SAMPLES));
        });
    }, [applyStatusLine]);

    async function align() {
        waitingForAlignmentStandbyRef.current = false;
        resetNavigationState();
        setPhase("aligning");
        setStatusLabel("정렬중");
        setLastResponse("ALIGN REQUESTED");

        try {
            await serial.writeLine("ALIGN");

            const aligning = await serial.waitForLine((line) => line === "STATUS:ALIGNING", 3000);

            if (!aligning) {
                setPhase("fault");
                setStatusLabel("정렬 실패");
                setLastResponse("TIMEOUT:STATUS:ALIGNING");
                return;
            }

            waitingForAlignmentStandbyRef.current = true;

            const standby = await serial.waitForLine((line) => line.startsWith("STATUS:STANDBY"), 12000);

            if (!standby) {
                waitingForAlignmentStandbyRef.current = false;
                setPhase("fault");
                setStatusLabel("정렬 실패");
                setLastResponse("TIMEOUT:STATUS:STANDBY");
                return;
            }

            resetNavigationState();
            setPhase("standby");
            setStatusLabel("정렬 완료");
            setLastResponse(standby);
        } catch {
            waitingForAlignmentStandbyRef.current = false;
            setPhase("fault");
            setStatusLabel("정렬 실패");
            setLastResponse("ALIGN WRITE FAILED");
        }
    }

    async function startMeasurement() {
        waitingForAlignmentStandbyRef.current = false;
        resetNavigationState();
        setPhase("starting");
        setStatusLabel("측정 준비");
        setLastResponse("START REQUESTED");

        try {
            await serial.writeLine("START");
        } catch {
            setPhase("fault");
            setStatusLabel("시작 실패");
            setLastResponse("START WRITE FAILED");
        }
    }

    async function stopMeasurement() {
        if (isMeasurementStoppedRef.current) {
            return;
        }

        isMeasurementStoppedRef.current = true;
        setPhase("completed");
        setStatusLabel("측정 완료");
        setLastResponse("STOP REQUESTED");

        try {
            await serial.writeLine("STOP");
        } catch {
            setLastResponse("STOP WRITE FAILED");
        }
    }

    const samples = useMemo(
        () => createNavigationSamples(rawSamples, planeRotationDegrees),
        [rawSamples, planeRotationDegrees],
    );
    const currentSample = samples.at(-1) ?? null;
    const currentPosition = currentSample?.position ?? {x: 0, y: 0};
    const pathLength = getPathLength(samples.map((sample) => sample.position));
    const mapScale = getMapScale(samples.map((sample) => sample.position));
    const gridMeters = getGridMeters(mapScale);
    const isAligning = phase === "aligning";
    const isStartDisabled = phase !== "standby";
    const isMeasuring = phase === "starting" || phase === "moving";
    const isRotationDisabled = phase === "aligning";

    function changePlaneRotation(nextDegrees: number) {
        if (isRotationDisabled) {
            return;
        }

        const nextRotationDegrees = normalizeDegrees(nextDegrees);

        setPlaneRotationDegrees(nextRotationDegrees);
    }

    return (
        <section className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-5">
            <motion.div
                className="grid gap-4 border border-white/10 bg-white/3 p-5 xl:grid-cols-[1fr_auto]"
                initial={{opacity: 0, y: 12}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.36, ease: "easeOut"}}
            >
                <div className="grid gap-4 md:grid-cols-2">
                    <StatusCell label="항법 상태" value={statusLabel}/>
                    <MetricBlock label="경로 길이" value={`${formatMetric(pathLength)} m`}/>
                </div>

                <div className="grid items-center gap-3 sm:grid-cols-2 xl:w-72">
                    <Button
                        className="h-11 bg-white text-black transition-colors duration-200 hover:bg-white/90"
                        disabled={isAligning}
                        onClick={align}
                    >
                        <Compass className="size-4"/>
                        {isAligning ? "정렬중" : "정렬"}
                    </Button>
                    {isMeasuring ? (
                        <Button
                            className="h-11 border-red-400/30 bg-red-500/10 text-red-200 transition-colors duration-200 hover:bg-red-500 hover:text-white"
                            variant="outline"
                            onClick={stopMeasurement}
                        >
                            <Square className="size-4"/>
                            정지
                        </Button>
                    ) : (
                        <Button
                            className="h-11 border-white/20 bg-white/5 text-white transition-colors duration-200 hover:bg-white hover:text-black"
                            disabled={isStartDisabled}
                            variant="outline"
                            onClick={startMeasurement}
                        >
                            <Play className="size-4"/>
                            시작
                        </Button>
                    )}
                </div>
            </motion.div>

            <motion.div
                className="grid min-h-0 gap-5 xl:grid-cols-[1fr_320px]"
                initial={{opacity: 0, y: 14}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.42, delay: 0.05, ease: "easeOut"}}
            >
                <div className="relative min-h-0 overflow-hidden border border-white/10 bg-black">
                    <NavigationMap phase={phase} samples={samples} rotationDegrees={planeRotationDegrees} scale={mapScale}/>
                    <div className="pointer-events-none absolute left-5 top-5">
                        <p className="text-xs font-semibold tracking-[0.2em] text-white/40 uppercase">Plane Map</p>
                        <h2 className="mt-1 text-lg font-semibold text-white">관성 항법 위치 추정</h2>
                    </div>
                    <div className="pointer-events-none absolute bottom-5 left-5 border border-white/10 bg-black/70 px-3 py-2 text-sm text-white/55">
                        1 grid = {formatMetric(gridMeters)} m
                    </div>
                    <div className="pointer-events-none absolute bottom-5 right-5 flex items-center gap-2 border border-white/10 bg-black/70 px-3 py-2 text-sm text-white">
                        <LocateFixed className="size-4"/>
                        X {formatMetric(currentPosition.x)} m / Y {formatMetric(currentPosition.y)} m
                    </div>
                </div>

                <aside className="grid min-h-0 content-start gap-4 border border-white/10 bg-white/3 p-5 overflow-y-auto">
                    <h2 className="text-base font-semibold text-white">실시간 항법 값</h2>
                    <PlaneRotationControl
                        disabled={isRotationDisabled}
                        value={planeRotationDegrees}
                        onChange={changePlaneRotation}
                    />
                    <MetricBlock label="경로 길이" value={`${formatMetric(pathLength)} m`}/>
                    <MetricBlock label="위치 X" value={`${formatMetric(currentPosition.x)} m`}/>
                    <MetricBlock label="위치 Y" value={`${formatMetric(currentPosition.y)} m`}/>
                    <MetricBlock label="수집 샘플" value={`${samples.length}`}/>
                    <p className="border-t border-white/10 pt-4 text-sm text-white/45">
                        {lastResponse}
                    </p>
                </aside>
            </motion.div>
        </section>
    );
}

function NavigationMap({
    phase,
    rotationDegrees,
    samples,
    scale,
}: {
    phase: InsPhase;
    rotationDegrees: number;
    samples: NavigationSample[];
    scale: number;
}) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [hoverPoint, setHoverPoint] = useState<PathHoverPoint | null>(null);
    const pathViewPoints = samples.map((sample) => {
        const view = mapToViewBox(sample.position, scale);

        return {
            distance: Math.hypot(sample.position.x, sample.position.y),
            viewX: view.x,
            viewY: view.y,
        };
    });
    const pathPoints = pathViewPoints
        .map((point) => `${point.viewX.toFixed(2)},${point.viewY.toFixed(2)}`)
        .join(" ");
    const currentPoint = mapToViewBox(samples.at(-1)?.position ?? {x: 0, y: 0}, scale);
    const currentPosition = samples.at(-1)?.position ?? {x: 0, y: 0};
    const isCompleted = phase === "completed" && samples.length > 0;
    const gridLines = createGridLines(scale);

    function updateHoverPoint(event: ReactPointerEvent<SVGSVGElement>) {
        const svg = svgRef.current;
        const screenCTM = svg?.getScreenCTM();

        if (!svg || !screenCTM || pathViewPoints.length === 0) {
            setHoverPoint(null);
            return;
        }

        const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(screenCTM.inverse());
        let nearest: PathHoverPoint | null = null;
        let nearestDistanceSq = HOVER_HIT_RADIUS * HOVER_HIT_RADIUS;

        for (const point of pathViewPoints) {
            const dx = point.viewX - cursor.x;
            const dy = point.viewY - cursor.y;
            const distanceSq = dx * dx + dy * dy;

            if (distanceSq <= nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearest = point;
            }
        }

        setHoverPoint(nearest);
    }

    return (
        <svg
            ref={svgRef}
            className="size-full"
            role="img"
            viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
            preserveAspectRatio="xMidYMid meet"
            onPointerMove={updateHoverPoint}
            onPointerLeave={() => setHoverPoint(null)}
        >
            <rect width={MAP_SIZE} height={MAP_SIZE} fill="black"/>
            {gridLines.map((line) => (
                <g key={line.key}>
                    <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
                </g>
            ))}
            <line x1={0} y1={MAP_CENTER} x2={MAP_SIZE} y2={MAP_CENTER} stroke="rgba(248,113,113,0.4)" strokeWidth="1.5"/>
            <line x1={MAP_CENTER} y1={0} x2={MAP_CENTER} y2={MAP_SIZE} stroke="rgba(134,239,172,0.4)" strokeWidth="1.5"/>
            <g transform={`rotate(${-rotationDegrees} ${MAP_CENTER} ${MAP_CENTER})`}>
                <line x1={MAP_CENTER} y1={MAP_CENTER} x2={MAP_CENTER + 160} y2={MAP_CENTER} stroke="#f87171" strokeDasharray="8 8" strokeWidth="3"/>
                <line x1={MAP_CENTER} y1={MAP_CENTER} x2={MAP_CENTER} y2={MAP_CENTER - 160} stroke="#86efac" strokeDasharray="8 8" strokeWidth="3"/>
                <polygon points={`${MAP_CENTER + 176},${MAP_CENTER} ${MAP_CENTER + 150},${MAP_CENTER - 10} ${MAP_CENTER + 150},${MAP_CENTER + 10}`} fill="#f87171"/>
                <polygon points={`${MAP_CENTER},${MAP_CENTER - 176} ${MAP_CENTER - 10},${MAP_CENTER - 150} ${MAP_CENTER + 10},${MAP_CENTER - 150}`} fill="#86efac"/>
                <text x={MAP_CENTER + 186} y={MAP_CENTER + 7} fill="#f87171" fontSize="20" fontWeight="700">S-X</text>
                <text x={MAP_CENTER + 12} y={MAP_CENTER - 186} fill="#86efac" fontSize="20" fontWeight="700">S-Y</text>
            </g>
            <circle cx={MAP_CENTER} cy={MAP_CENTER} r="8" fill="white"/>
            <circle cx={MAP_CENTER} cy={MAP_CENTER} r="18" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2"/>
            {pathPoints ? (
                <polyline
                    fill="none"
                    points={`${MAP_CENTER},${MAP_CENTER} ${pathPoints}`}
                    stroke="#60a5fa"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="4"
                    vectorEffect="non-scaling-stroke"
                />
            ) : null}
            <motion.circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                fill="none"
                initial={false}
                r="12"
                stroke="#60a5fa"
                strokeWidth="5"
                animate={{
                    opacity: [0.28, 0],
                    r: [12, 42],
                }}
                transition={{
                    duration: 2.4,
                    ease: "easeOut",
                    repeat: Infinity,
                }}
            />
            <motion.circle
                cx={currentPoint.x}
                cy={currentPoint.y}
                fill="none"
                initial={false}
                r="10"
                stroke="#60a5fa"
                strokeWidth="3"
                animate={{
                    opacity: [0.22, 0],
                    r: [10, 32],
                }}
                transition={{
                    delay: 0.7,
                    duration: 2.4,
                    ease: "easeOut",
                    repeat: Infinity,
                }}
            />
            <circle cx={currentPoint.x} cy={currentPoint.y} r="8" fill="#60a5fa"/>
            <circle cx={currentPoint.x} cy={currentPoint.y} r="18" fill="none" stroke="rgba(96,165,250,0.36)" strokeWidth="3"/>
            {isCompleted ? (
                <g transform={`translate(${Math.min(currentPoint.x + 24, MAP_SIZE - 250)} ${Math.max(currentPoint.y - 58, 48)})`}>
                    <rect width="226" height="48" fill="rgba(0,0,0,0.82)" stroke="rgba(255,255,255,0.18)"/>
                    <text x="12" y="19" fill="rgba(255,255,255,0.55)" fontSize="12" fontWeight="700" letterSpacing="2">FINAL POSITION</text>
                    <text x="12" y="37" fill="white" fontSize="16" fontWeight="700">
                        X {formatMetric(currentPosition.x)} m / Y {formatMetric(currentPosition.y)} m
                    </text>
                </g>
            ) : null}
            {hoverPoint ? (
                <g pointerEvents="none">
                    <line
                        x1={MAP_CENTER}
                        y1={MAP_CENTER}
                        x2={hoverPoint.viewX}
                        y2={hoverPoint.viewY}
                        stroke="rgba(250,204,21,0.75)"
                        strokeDasharray="6 6"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={hoverPoint.viewX} cy={hoverPoint.viewY} r="7" fill="#facc15" stroke="black" strokeWidth="1.5"/>
                    <g transform={`translate(${Math.min(hoverPoint.viewX + 20, MAP_SIZE - 208)} ${Math.max(hoverPoint.viewY - 54, 16)})`}>
                        <rect width="196" height="44" fill="rgba(0,0,0,0.85)" stroke="rgba(250,204,21,0.4)"/>
                        <text x="12" y="18" fill="rgba(255,255,255,0.55)" fontSize="12" fontWeight="700">원점 거리</text>
                        <text x="12" y="35" fill="#facc15" fontSize="16" fontWeight="700">{formatMetric(hoverPoint.distance)} m</text>
                    </g>
                </g>
            ) : null}
            <text x={MAP_SIZE - 58} y={MAP_CENTER - 14} fill="#f87171" fontSize="24" fontWeight="700">+X</text>
            <text x={MAP_CENTER + 14} y={58} fill="#86efac" fontSize="24" fontWeight="700">+Y</text>
        </svg>
    );
}

function StatusCell({label, value}: {label: string; value: string}) {
    return (
        <div className="border border-white/10 bg-black/40 px-4 py-3">
            <p className="text-xs font-semibold text-white/40 uppercase">{label}</p>
            <p className="mt-2 truncate text-sm font-semibold text-white">{value}</p>
        </div>
    );
}

function MetricBlock({label, value}: {label: string; value: string}) {
    return (
        <div className="border border-white/10 bg-black/45 px-4 py-3">
            <p className="text-xs font-semibold tracking-[0.12em] text-white/35 uppercase">{label}</p>
            <p className="mt-2 text-lg font-semibold text-white">{value}</p>
        </div>
    );
}

function PlaneRotationControl({
    disabled,
    value,
    onChange,
}: {
    disabled: boolean;
    value: number;
    onChange(value: number): void;
}) {
    return (
        <div className="border border-white/10 bg-black/45 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-white/35 uppercase">평면 회전</p>
                    <p className="mt-2 text-lg font-semibold text-white">{formatDegrees(value)}°</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        aria-label="평면 반시계 방향 회전"
                        className="grid size-9 place-items-center border border-white/10 bg-white/5 text-white transition-colors duration-200 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={disabled}
                        type="button"
                        onClick={() => onChange(value - 5)}
                    >
                        <RotateCcw className="size-4"/>
                    </button>
                    <button
                        aria-label="평면 시계 방향 회전"
                        className="grid size-9 place-items-center border border-white/10 bg-white/5 text-white transition-colors duration-200 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={disabled}
                        type="button"
                        onClick={() => onChange(value + 5)}
                    >
                        <RotateCw className="size-4"/>
                    </button>
                </div>
            </div>
            <input
                aria-label="평면 회전 각도"
                className="mt-4 w-full accent-white disabled:cursor-not-allowed disabled:opacity-35"
                disabled={disabled}
                max={180}
                min={-180}
                step={1}
                type="range"
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
            />
            <div className="mt-3 grid grid-cols-3 gap-2">
                {[-90, 0, 90].map((degree) => (
                    <button
                        key={degree}
                        className="h-8 border border-white/10 bg-white/5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={disabled}
                        type="button"
                        onClick={() => onChange(degree)}
                    >
                        {formatDegrees(degree)}°
                    </button>
                ))}
            </div>
        </div>
    );
}

function createNavigationSamples(rawSamples: RawNavigationSample[], rotationDegrees: number): NavigationSample[] {
    let velocity: Vector2Value = {x: 0, y: 0};
    let position: Vector2Value = {x: 0, y: 0};

    return rawSamples.map((sample) => {
        const acceleration = rotateVector2(
            {
                x: sample.acceleration.x,
                y: sample.acceleration.y,
            },
            rotationDegrees,
        );
        const nextVelocity = {
            x: velocity.x + acceleration.x * sample.dt,
            y: velocity.y + acceleration.y * sample.dt,
        };
        const nextPosition = {
            x: position.x + ((velocity.x + nextVelocity.x) / 2) * sample.dt,
            y: position.y + ((velocity.y + nextVelocity.y) / 2) * sample.dt,
        };

        velocity = nextVelocity;
        position = nextPosition;

        return {
            acceleration,
            position,
            timeSeconds: sample.timeSeconds,
            timestamp: sample.timestamp,
            velocity,
        };
    });
}

function parseAcceleration(line: string): Vector3Value | null {
    const section = line.split("/").find((part) => part.startsWith("ACC:"));

    if (!section) {
        return null;
    }

    const values = section
        .slice("ACC:".length)
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

function rotateVector2(vector: Vector2Value, degrees: number): Vector2Value {
    const radians = (degrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    return {
        x: vector.x * cos - vector.y * sin,
        y: vector.x * sin + vector.y * cos,
    };
}

function getPathLength(points: Vector2Value[]) {
    return points.reduce((length, point, index) => {
        if (index === 0) {
            return length;
        }

        const previousPoint = points[index - 1];
        const dx = point.x - previousPoint.x;
        const dy = point.y - previousPoint.y;

        return length + Math.sqrt(dx * dx + dy * dy);
    }, 0);
}

function getMapScale(points: Vector2Value[]) {
    const maxAbs = Math.max(
        DEFAULT_GRID_METERS,
        ...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]),
    );
    const requiredGridMeters = maxAbs / (MAP_PADDING_RATIO * 10);

    return getNiceMapScale(Math.max(DEFAULT_GRID_METERS, requiredGridMeters));
}

function getGridMeters(gridMeters: number) {
    return gridMeters;
}

function getNiceMapScale(value: number) {
    const exponent = Math.floor(Math.log10(value));
    const base = 10 ** exponent;
    const normalized = value / base;

    if (normalized <= 1) {
        return base;
    }

    if (normalized <= 2) {
        return 2 * base;
    }

    if (normalized <= 5) {
        return 5 * base;
    }

    return 10 * base;
}

function createGridLines(scale: number) {
    const step = MAP_SIZE * 0.1;
    const lines = [];

    for (let index = 1; index < 10; index++) {
        const coordinate = step * index;

        lines.push({
            key: `x-${index}`,
            x1: coordinate,
            y1: 0,
            x2: coordinate,
            y2: MAP_SIZE,
        });
        lines.push({
            key: `y-${index}-${scale}`,
            x1: 0,
            y1: coordinate,
            x2: MAP_SIZE,
            y2: coordinate,
        });
    }

    return lines;
}

function mapToViewBox(point: Vector2Value, scale: number) {
    return {
        x: MAP_CENTER + (point.x / scale) * (MAP_SIZE * 0.1),
        y: MAP_CENTER - (point.y / scale) * (MAP_SIZE * 0.1),
    };
}

function formatMetric(value: number) {
    const normalized = Math.abs(value) < 0.0001 ? 0 : value;

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(normalized) < 1 ? 4 : 2,
        minimumFractionDigits: 0,
    }).format(normalized);
}

function normalizeDegrees(value: number) {
    let normalized = value;

    while (normalized > 180) {
        normalized -= 360;
    }

    while (normalized < -180) {
        normalized += 360;
    }

    return normalized;
}

function formatDegrees(value: number) {
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
    }).format(value);
}
