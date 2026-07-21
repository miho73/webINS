import {useEffect, useRef, useState} from "react";
import type {PointerEvent as ReactPointerEvent} from "react";
import {motion} from "framer-motion";
import {Compass, Play, Square} from "lucide-react";

import {Button} from "@/components/ui/button.tsx";
import serial from "@/core/Serial.ts";

type Vector3Value = {
    x: number;
    y: number;
    z: number;
};

type AxisKey = "x" | "y" | "z";

type IntegralPhase = "idle" | "aligning" | "standby" | "starting" | "moving" | "completed" | "fault";

type AccelerationSample = {
    timestamp: number;
    timeSeconds: number;
    value: Vector3Value;
};

type GraphSeries = {
    color: string;
    label: string;
    values: number[];
};

type ScalarSample = {
    timeSeconds: number;
    value: number;
};

type PaintSelection = {
    axis: AxisKey;
    markers: ScalarSample[];
};

type IntegratedMotion = {
    accelerationMarkers: ScalarSample[];
    position: ScalarSample[];
    velocity: ScalarSample[];
    velocityMarkers: ScalarSample[];
};

type GraphHoverValue = {
    color: string;
    label: string;
    value: number;
};

type GraphHoverState = {
    timeSeconds: number;
    values: GraphHoverValue[];
    x: number;
    y: number;
};

const MAX_SAMPLES = 360;
const INTEGRATION_SAMPLE_RATE = 200;
const INTEGRATION_DT = 1 / INTEGRATION_SAMPLE_RATE;
const GRAPH_WIDTH = 420;
const GRAPH_HEIGHT = 260;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 396;
const PLOT_TOP = 20;
const PLOT_BOTTOM = 232;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const PLOT_CENTER_Y = (PLOT_TOP + PLOT_BOTTOM) / 2;
const PLOT_HALF_HEIGHT = (PLOT_BOTTOM - PLOT_TOP) / 2;
const AXIS_OPTIONS: Array<{key: AxisKey; label: string; color: string}> = [
    {key: "x", label: "X", color: "#f87171"},
    {key: "y", label: "Y", color: "#86efac"},
    {key: "z", label: "Z", color: "#60a5fa"},
];

export function Integral() {
    const [phase, setPhase] = useState<IntegralPhase>("idle");
    const [statusLabel, setStatusLabel] = useState("정렬 필요");
    const [lastResponse, setLastResponse] = useState("대기");
    const [gravity, setGravity] = useState<number | null>(null);
    const [movementStartAt, setMovementStartAt] = useState<number | null>(null);
    const [accelerationSamples, setAccelerationSamples] = useState<AccelerationSample[]>([]);
    const [selectedAxis, setSelectedAxis] = useState<AxisKey>("x");
    const [accelerationPaintSelection, setAccelerationPaintSelection] = useState<PaintSelection | null>(null);
    const [velocityPaintSelection, setVelocityPaintSelection] = useState<PaintSelection | null>(null);
    const waitingForAlignmentStandbyRef = useRef(false);
    const movementStartAtRef = useRef<number | null>(null);
    const isMeasurementStoppedRef = useRef(false);
    const isAccelerationPaintingRef = useRef(false);
    const isVelocityPaintingRef = useRef(false);

    function applyStatusLine(line: string, receivedAt: number) {
        const payload = line.replace("STATUS:", "");
        const statusName = payload.split(",")[0];

        setLastResponse(line);

        if (statusName === "ALIGNING") {
            setPhase("aligning");
            setStatusLabel("정렬중");
            return;
        }

        if (statusName === "STANDBY") {
            const gravityMatch = line.match(/G:([-+]?\d+(?:\.\d+)?)/);
            const isAlignmentStandby = waitingForAlignmentStandbyRef.current;

            waitingForAlignmentStandbyRef.current = false;
            setPhase(isAlignmentStandby ? "standby" : "idle");
            setStatusLabel(isAlignmentStandby ? "정렬 완료" : "정렬 필요");

            if (isAlignmentStandby && gravityMatch) {
                setGravity(Number(gravityMatch[1]));
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
                isMeasurementStoppedRef.current = false;
                setMovementStartAt(receivedAt);
                setAccelerationSamples([]);
            }

            setPhase("moving");
            setStatusLabel("측정중");
        }
    }

    useEffect(() => {
        return serial.subscribe((line) => {
            const receivedAt = Date.now();

            if (line.startsWith("STATUS:")) {
                applyStatusLine(line, receivedAt);
            }

            const acceleration = parseAcceleration(line);

            if (acceleration && movementStartAtRef.current !== null && !isMeasurementStoppedRef.current) {
                const timeSeconds = (receivedAt - movementStartAtRef.current) / 1000;

                setAccelerationSamples((samples) => [
                    ...samples,
                    {
                        timestamp: receivedAt,
                        timeSeconds,
                        value: acceleration,
                    },
                ].slice(-MAX_SAMPLES));
            }
        });
    }, []);

    async function align() {
        waitingForAlignmentStandbyRef.current = false;
        movementStartAtRef.current = null;
        isMeasurementStoppedRef.current = false;
        setMovementStartAt(null);
        setAccelerationSamples([]);
        setAccelerationPaintSelection(null);
        setVelocityPaintSelection(null);
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

            const gravityMatch = standby.match(/G:([-+]?\d+(?:\.\d+)?)/);

            if (gravityMatch) {
                setGravity(Number(gravityMatch[1]));
            }

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
        movementStartAtRef.current = null;
        isMeasurementStoppedRef.current = false;
        setMovementStartAt(null);
        setAccelerationSamples([]);
        setAccelerationPaintSelection(null);
        setVelocityPaintSelection(null);
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

    const accelerationSeries = createSeries(accelerationSamples.map((sample) => sample.value));
    const timeValues = accelerationSamples.map((sample) => sample.timeSeconds);
    const graphMaxTime = getGraphMaxTime(timeValues);
    const integratedMotion = createIntegratedMotion(accelerationPaintSelection, velocityPaintSelection);
    const velocitySeries = createScalarSeries(selectedAxis, integratedMotion.velocity.map((sample) => sample.value));
    const velocityTimeValues = integratedMotion.velocity.map((sample) => sample.timeSeconds);
    const positionSeries = createScalarSeries(selectedAxis, integratedMotion.position.map((sample) => sample.value));
    const positionTimeValues = integratedMotion.position.map((sample) => sample.timeSeconds);
    const latestVelocity = integratedMotion.velocity.at(-1)?.value ?? 0;
    const latestPosition = integratedMotion.position.at(-1)?.value ?? 0;
    const isAligning = phase === "aligning";
    const isStartDisabled = phase !== "standby";
    const isStopDisabled = phase !== "starting" && phase !== "moving";

    function changeSelectedAxis(axis: AxisKey) {
        setSelectedAxis(axis);
        setAccelerationPaintSelection(null);
        setVelocityPaintSelection(null);
    }

    function startAccelerationPaint(point: ScalarSample) {
        isAccelerationPaintingRef.current = true;
        setVelocityPaintSelection(null);
        setAccelerationPaintSelection({
            axis: selectedAxis,
            markers: [normalizePaintMarker(point)],
        });
    }

    function moveAccelerationPaint(point: ScalarSample) {
        if (!isAccelerationPaintingRef.current) {
            return;
        }

        setVelocityPaintSelection(null);
        setAccelerationPaintSelection((selection) => {
            if (!selection || selection.axis !== selectedAxis) {
                return {
                    axis: selectedAxis,
                    markers: [normalizePaintMarker(point)],
                };
            }

            return {
                ...selection,
                markers: mergePaintMarker(selection.markers, point),
            };
        });
    }

    function endAccelerationPaint() {
        isAccelerationPaintingRef.current = false;
    }

    function startVelocityPaint(point: ScalarSample) {
        isVelocityPaintingRef.current = true;
        setVelocityPaintSelection({
            axis: selectedAxis,
            markers: [normalizePaintMarker(point)],
        });
    }

    function moveVelocityPaint(point: ScalarSample) {
        if (!isVelocityPaintingRef.current) {
            return;
        }

        setVelocityPaintSelection((selection) => {
            if (!selection || selection.axis !== selectedAxis) {
                return {
                    axis: selectedAxis,
                    markers: [normalizePaintMarker(point)],
                };
            }

            return {
                ...selection,
                markers: mergePaintMarker(selection.markers, point),
            };
        });
    }

    function endVelocityPaint() {
        isVelocityPaintingRef.current = false;
    }

    return (
        <section className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-5">
            <motion.div
                className="grid gap-4 border border-white/10 bg-white/3 p-5 lg:grid-cols-[1fr_auto]"
                initial={{opacity: 0, y: 12}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.36, ease: "easeOut"}}
            >
                <div className="grid gap-4 sm:grid-cols-4">
                    <StatusCell label="정렬 상태" value={statusLabel}/>
                    <StatusCell label="중력가속도" value={gravity === null ? "대기" : `${gravity.toFixed(4)} m/s²`}/>
                    <StatusCell label="기준 시각" value={movementStartAt === null ? "MOVING 대기" : "t = 0.000 s"}/>
                    <AxisSelector selectedAxis={selectedAxis} onChange={changeSelectedAxis}/>
                </div>

                <div className="grid gap-3 items-center sm:grid-cols-3 lg:w-96">
                    <Button
                        className="h-11 bg-white text-black transition-colors duration-200 hover:bg-white/90"
                        disabled={isAligning}
                        onClick={align}
                    >
                        <Compass className="size-4"/>
                        {isAligning ? "정렬중" : "정렬"}
                    </Button>
                    <Button
                        className="h-11 border-white/20 bg-white/5 text-white transition-colors duration-200 hover:bg-white hover:text-black"
                        disabled={isStartDisabled}
                        variant="outline"
                        onClick={startMeasurement}
                    >
                        <Play className="size-4"/>
                        시작
                    </Button>
                    <Button
                        className="h-11 border-red-400/30 bg-red-500/10 text-red-200 transition-colors duration-200 hover:bg-red-500 hover:text-white"
                        disabled={isStopDisabled}
                        variant="outline"
                        onClick={stopMeasurement}
                    >
                        <Square className="size-4"/>
                        정지
                    </Button>
                </div>
            </motion.div>

            <motion.div
                className="grid min-h-0 gap-5 lg:grid-cols-3"
                initial={{opacity: 0, y: 14}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.42, delay: 0.05, ease: "easeOut"}}
            >
                <GraphPanel
                    isSelectable
                    maxTimeOverride={graphMaxTime}
                    onPaintEnd={endAccelerationPaint}
                    onPaintMove={moveAccelerationPaint}
                    onPaintStart={startAccelerationPaint}
                    paintMarkers={integratedMotion.accelerationMarkers}
                    selectedAxis={selectedAxis}
                    selectedSelection={accelerationPaintSelection}
                    title="시간-가속도"
                    unit="m/s²"
                    timeValues={timeValues}
                    series={accelerationSeries}
                    footer={`${selectedAxis.toUpperCase()}축 / 가속도 마커 ${accelerationPaintSelection?.markers.length ?? 0}`}
                    emptyMessage={movementStartAt === null ? "이동 감지중" : "가속도 샘플 대기"}
                />
                <GraphPanel
                    isSelectable
                    maxTimeOverride={graphMaxTime}
                    onPaintEnd={endVelocityPaint}
                    onPaintMove={moveVelocityPaint}
                    onPaintStart={startVelocityPaint}
                    paintMarkers={integratedMotion.velocityMarkers}
                    selectedAxis={selectedAxis}
                    selectedSelection={velocityPaintSelection}
                    title="시간-속도"
                    unit="m/s"
                    timeValues={velocityTimeValues}
                    series={velocitySeries}
                    footer={`${selectedAxis.toUpperCase()}축 속도 ${formatCompactNumber(latestVelocity)} m/s / 속도 마커 ${velocityPaintSelection?.markers.length ?? 0}`}
                    emptyMessage="가속도 그래프 영역 선택"
                />
                <GraphPanel
                    maxTimeOverride={graphMaxTime}
                    title="시간-위치"
                    unit="m"
                    timeValues={positionTimeValues}
                    series={positionSeries}
                    footer={`${selectedAxis.toUpperCase()}축 변위 ${formatCompactNumber(latestPosition)} m`}
                    emptyMessage="속도 그래프 영역 선택"
                />
            </motion.div>

            <p className="sr-only">{lastResponse}</p>
        </section>
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

function AxisSelector({selectedAxis, onChange}: {selectedAxis: AxisKey; onChange(axis: AxisKey): void}) {
    return (
        <div className="border border-white/10 bg-black/40 px-4 py-3">
            <p className="text-xs font-semibold text-white/40 uppercase">적분 축</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
                {AXIS_OPTIONS.map((axis) => {
                    const isActive = selectedAxis === axis.key;

                    return (
                        <button
                            key={axis.key}
                            className={[
                                "h-8 border text-sm font-semibold transition-colors duration-200",
                                isActive
                                    ? "border-white bg-white text-black"
                                    : "border-white/10 bg-white/5 text-white hover:bg-white/10",
                            ].join(" ")}
                            type="button"
                            onClick={() => onChange(axis.key)}
                        >
                            {axis.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function GraphPanel({
    isSelectable = false,
    maxTimeOverride,
    onPaintEnd,
    onPaintMove,
    onPaintStart,
    paintMarkers = [],
    selectedAxis,
    selectedSelection,
    title,
    unit,
    timeValues,
    series,
    footer,
    emptyMessage,
}: {
    isSelectable?: boolean;
    maxTimeOverride?: number;
    onPaintEnd?(): void;
    onPaintMove?(point: ScalarSample): void;
    onPaintStart?(point: ScalarSample): void;
    paintMarkers?: ScalarSample[];
    selectedAxis?: AxisKey;
    selectedSelection?: PaintSelection | null;
    title: string;
    unit: string;
    timeValues: number[];
    series: GraphSeries[];
    footer: string;
    emptyMessage: string;
}) {
    const [hoverState, setHoverState] = useState<GraphHoverState | null>(null);
    const hasData = timeValues.length > 1 && series.some((item) => item.values.length > 1);
    const maxTime = maxTimeOverride ?? getGraphMaxTime(timeValues);
    const maxAbs = getGraphMaxAbs(series);

    function getEventLocation(event: ReactPointerEvent<SVGSVGElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * GRAPH_WIDTH;
        const svgY = ((event.clientY - rect.top) / rect.height) * GRAPH_HEIGHT;
        const ratio = (clamp(svgX, PLOT_LEFT, PLOT_RIGHT) - PLOT_LEFT) / PLOT_WIDTH;
        const valueRatio = (PLOT_CENTER_Y - clamp(svgY, PLOT_TOP, PLOT_BOTTOM)) / PLOT_HALF_HEIGHT;

        return {
            point: {
                timeSeconds: clamp(ratio * maxTime, 0, maxTime),
                value: valueRatio * maxAbs,
            },
            x: clamp(svgX, PLOT_LEFT, PLOT_RIGHT),
            y: clamp(svgY, PLOT_TOP, PLOT_BOTTOM),
        };
    }

    function updateHoverState(location: ReturnType<typeof getEventLocation>) {
        if (!hasData) {
            setHoverState(null);
            return;
        }

        setHoverState({
            timeSeconds: location.point.timeSeconds,
            values: getHoverValues(series, timeValues, location.point.timeSeconds),
            x: location.x,
            y: location.y,
        });
    }

    function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
        const location = getEventLocation(event);

        updateHoverState(location);

        if (!isSelectable || !hasData || !onPaintStart) {
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        onPaintStart(location.point);
    }

    function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
        const location = getEventLocation(event);

        updateHoverState(location);

        if (!isSelectable || !hasData || !onPaintMove || event.buttons !== 1) {
            return;
        }

        onPaintMove(location.point);
    }

    function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
        if (!isSelectable) {
            return;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        onPaintEnd?.();
    }

    function handlePointerLeave() {
        setHoverState(null);
        onPaintEnd?.();
    }

    return (
        <div className="grid min-h-0 grid-rows-[auto_1fr_auto] border border-white/10 bg-white/3 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold tracking-[0.2em] text-white/40 uppercase">Graph</p>
                    <h2 className="mt-1 text-base font-semibold text-white">{title}</h2>
                </div>
                <span className="text-sm text-white/45">{unit}</span>
            </div>

            <div className="relative min-h-0 overflow-hidden border border-white/10 bg-black">
                <svg
                    className={isSelectable ? "size-full cursor-crosshair" : "size-full"}
                    role="img"
                    viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                    preserveAspectRatio="none"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerLeave}
                >
                    <GraphGrid maxAbs={maxAbs} maxTime={maxTime}/>
                    {selectedSelection && selectedAxis ? (
                        <GraphSelectionArea
                            maxAbs={maxAbs}
                            maxTime={maxTime}
                            selectedAxis={selectedAxis}
                            paintMarkers={paintMarkers}
                            selectedSelection={selectedSelection}
                        />
                    ) : null}
                    {hasData ? (
                        <GraphLines maxAbs={maxAbs} maxTime={maxTime} timeValues={timeValues} series={series}/>
                    ) : null}
                    {hoverState ? (
                        <GraphHoverGuide hoverState={hoverState} maxAbs={maxAbs}/>
                    ) : null}
                </svg>
                <GraphAxisOverlay maxAbs={maxAbs} maxTime={maxTime}/>
                {hoverState ? (
                    <GraphHoverTooltip hoverState={hoverState} unit={unit}/>
                ) : null}

                {!hasData && (
                    <div className="absolute inset-0 grid place-items-center">
                        <span className="border border-white/15 bg-black/70 px-4 py-2 text-sm text-white/45">
                            {emptyMessage}
                        </span>
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 text-sm text-white/45">
                <span className="truncate">{footer}</span>
                <div className="flex shrink-0 items-center gap-3">
                    {series.map((item) => (
                        <span key={item.label} className="flex items-center gap-1">
                            <span className="size-2" style={{backgroundColor: item.color}}/>
                            {item.label}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}

function GraphGrid({maxAbs, maxTime}: {maxAbs: number; maxTime: number}) {
    const timeTicks = createTimeTicks(maxTime);
    const valueTicks = createValueTicks(maxAbs);

    return (
        <>
            {timeTicks.map((tick) => {
                const x = PLOT_LEFT + (tick / maxTime) * PLOT_WIDTH;

                return (
                    <line key={tick} x1={x} y1={PLOT_TOP} x2={x} y2={PLOT_BOTTOM} stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
                );
            })}
            {valueTicks.map((tick) => {
                const y = getGraphY(tick, maxAbs);

                return (
                    <line key={tick} x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} stroke="rgba(255,255,255,0.08)" strokeWidth="1"/>
                );
            })}
            <line x1={PLOT_LEFT} y1={PLOT_CENTER_Y} x2={PLOT_RIGHT} y2={PLOT_CENTER_Y} stroke="rgba(255,255,255,0.24)" strokeWidth="1"/>
            <line x1={PLOT_LEFT} y1={PLOT_TOP} x2={PLOT_LEFT} y2={PLOT_BOTTOM} stroke="rgba(255,255,255,0.18)" strokeWidth="1"/>
        </>
    );
}

function GraphAxisOverlay({maxAbs, maxTime}: {maxAbs: number; maxTime: number}) {
    const timeTicks = createTimeTicks(maxTime);
    const valueTicks = createValueTicks(maxAbs);

    return (
        <div className="pointer-events-none absolute inset-0 text-xs text-white/50">
            {valueTicks.map((tick) => (
                <span
                    key={tick}
                    className="absolute w-10 text-right"
                    style={{
                        left: `${(PLOT_LEFT / GRAPH_WIDTH) * 100}%`,
                        top: `${(getGraphY(tick, maxAbs) / GRAPH_HEIGHT) * 100}%`,
                        transform: "translate(-115%, -50%)",
                    }}
                >
                    {formatValueTick(tick)}
                </span>
            ))}
            {timeTicks.map((tick) => (
                <span
                    key={tick}
                    className="absolute text-center"
                    style={{
                        left: `${(getGraphX(tick, maxTime) / GRAPH_WIDTH) * 100}%`,
                        top: `${(246 / GRAPH_HEIGHT) * 100}%`,
                        transform: "translateX(-50%)",
                    }}
                >
                    {formatTimeTick(tick)}
                </span>
            ))}
        </div>
    );
}

function GraphLines({maxAbs, maxTime, timeValues, series}: {maxAbs: number; maxTime: number; timeValues: number[]; series: GraphSeries[]}) {
    return (
        <>
            {series.map((item) => {
                const points = item.values
                    .map((value, index) => {
                        const x = getGraphX(timeValues[index], maxTime);
                        const y = getGraphY(value, maxAbs);

                        return `${x.toFixed(2)},${y.toFixed(2)}`;
                    })
                    .join(" ");

                return (
                    <polyline
                        key={item.label}
                        fill="none"
                        points={points}
                        stroke={item.color}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                    />
                );
            })}
        </>
    );
}

function GraphHoverGuide({hoverState, maxAbs}: {hoverState: GraphHoverState; maxAbs: number}) {
    return (
        <>
            <line
                x1={hoverState.x}
                y1={PLOT_TOP}
                x2={hoverState.x}
                y2={PLOT_BOTTOM}
                stroke="rgba(255,255,255,0.42)"
                strokeDasharray="3 3"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
            />
            {hoverState.values.map((item) => (
                <circle
                    key={item.label}
                    cx={hoverState.x}
                    cy={getGraphY(item.value, maxAbs)}
                    fill={item.color}
                    r="3"
                    stroke="black"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </>
    );
}

function GraphHoverTooltip({hoverState, unit}: {hoverState: GraphHoverState; unit: string}) {
    const isRightSide = hoverState.x > GRAPH_WIDTH * 0.62;

    return (
        <div
            className="pointer-events-none absolute z-10 min-w-36 border border-white/15 bg-black/90 px-3 py-2 text-xs text-white shadow-lg"
            style={{
                left: `${(hoverState.x / GRAPH_WIDTH) * 100}%`,
                top: `${(hoverState.y / GRAPH_HEIGHT) * 100}%`,
                transform: isRightSide ? "translate(-105%, -50%)" : "translate(8%, -50%)",
            }}
        >
            <p className="font-semibold text-white">t = {formatHoverNumber(hoverState.timeSeconds)} s</p>
            <div className="mt-2 grid gap-1">
                {hoverState.values.map((item) => (
                    <p key={item.label} className="flex items-center justify-between gap-3 text-white/70">
                        <span className="flex items-center gap-1">
                            <span className="size-2" style={{backgroundColor: item.color}}/>
                            {item.label}
                        </span>
                        <span className="font-semibold text-white">
                            {formatHoverNumber(item.value)} {unit}
                        </span>
                    </p>
                ))}
            </div>
        </div>
    );
}

function GraphSelectionArea({
    maxAbs,
    maxTime,
    paintMarkers,
    selectedAxis,
    selectedSelection,
}: {
    maxAbs: number;
    maxTime: number;
    paintMarkers: ScalarSample[];
    selectedAxis: AxisKey;
    selectedSelection: PaintSelection;
}) {
    const markers = paintMarkers.length > 0 ? paintMarkers : selectedSelection.markers;

    if (selectedSelection.axis !== selectedAxis || markers.length < 2) {
        return null;
    }

    const selectedColor = getAxisColor(selectedAxis);
    const startTime = clamp(markers[0].timeSeconds, 0, maxTime);
    const endTime = clamp(markers[markers.length - 1].timeSeconds, 0, maxTime);
    const zeroY = getGraphY(0, maxAbs);
    const areaPoints = [
        `${getGraphX(startTime, maxTime).toFixed(2)},${zeroY.toFixed(2)}`,
        ...markers.map((point) => `${getGraphX(point.timeSeconds, maxTime).toFixed(2)},${getGraphY(point.value, maxAbs).toFixed(2)}`),
        `${getGraphX(endTime, maxTime).toFixed(2)},${zeroY.toFixed(2)}`,
    ].join(" ");

    return (
        <>
            <polygon fill={selectedColor} opacity="0.22" points={areaPoints}/>
            <polyline
                fill="none"
                points={markers.map((point) => `${getGraphX(point.timeSeconds, maxTime).toFixed(2)},${getGraphY(point.value, maxAbs).toFixed(2)}`).join(" ")}
                stroke={selectedColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
            />
            <line x1={getGraphX(startTime, maxTime)} y1={PLOT_TOP} x2={getGraphX(startTime, maxTime)} y2={PLOT_BOTTOM} stroke={selectedColor} strokeWidth="1.5"/>
            <line x1={getGraphX(endTime, maxTime)} y1={PLOT_TOP} x2={getGraphX(endTime, maxTime)} y2={PLOT_BOTTOM} stroke={selectedColor} strokeWidth="1.5"/>
        </>
    );
}

function getGraphMaxTime(timeValues: number[]) {
    const maxTime = Math.max(0.2, ...timeValues);
    const step = getNiceStep(maxTime / 4);

    return step * 4;
}

function getGraphMaxAbs(series: GraphSeries[]) {
    const allValues = series.flatMap((item) => item.values);
    const maxAbs = Math.max(...allValues.map((value) => Math.abs(value)));

    if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
        return 1;
    }

    const paddedMaxAbs = maxAbs * 1.15;
    const step = getNiceStep(paddedMaxAbs / 2);

    return step * 2;
}

function getGraphX(time: number, maxTime: number) {
    return PLOT_LEFT + (time / maxTime) * PLOT_WIDTH;
}

function getGraphY(value: number, maxAbs: number) {
    return PLOT_CENTER_Y - (value / maxAbs) * PLOT_HALF_HEIGHT;
}

function createTimeTicks(maxTime: number) {
    return [0, 0.5, 1].map((ratio) => maxTime * ratio);
}

function createValueTicks(maxAbs: number) {
    return [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map((ratio) => maxAbs * ratio);
}

function getHoverValues(series: GraphSeries[], timeValues: number[], timeSeconds: number): GraphHoverValue[] {
    return series
        .filter((item) => item.values.length > 1)
        .map((item) => ({
            color: item.color,
            label: item.label,
            value: interpolateScalar(timeValues, item.values, timeSeconds),
        }));
}

function formatTimeTick(value: number) {
    return formatCompactNumber(value);
}

function formatValueTick(value: number) {
    return formatCompactNumber(value);
}

function formatCompactNumber(value: number) {
    const normalized = Math.abs(value) < 0.0001 ? 0 : value;

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(normalized) < 1 ? 2 : 1,
        minimumFractionDigits: 0,
    }).format(normalized);
}

function formatHoverNumber(value: number) {
    const normalized = Math.abs(value) < 0.0001 ? 0 : value;

    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: Math.abs(normalized) < 1 ? 4 : 3,
        minimumFractionDigits: 0,
    }).format(normalized);
}

function getNiceStep(rawStep: number) {
    const exponent = Math.floor(Math.log10(rawStep));
    const base = 10 ** exponent;
    const normalized = rawStep / base;

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

function createSeries(values: Vector3Value[]): GraphSeries[] {
    return [
        {
            label: "X",
            color: "#f87171",
            values: values.map((value) => value.x),
        },
        {
            label: "Y",
            color: "#86efac",
            values: values.map((value) => value.y),
        },
        {
            label: "Z",
            color: "#60a5fa",
            values: values.map((value) => value.z),
        },
    ];
}

function createScalarSeries(axis: AxisKey, values: number[]): GraphSeries[] {
    return [
        {
            label: axis.toUpperCase(),
            color: getAxisColor(axis),
            values,
        },
    ];
}

function createIntegratedMotion(accelerationSelection: PaintSelection | null, velocitySelection: PaintSelection | null): IntegratedMotion {
    const accelerationMarkers = createResampledMarkers(accelerationSelection);
    const velocity = integrateSamples(accelerationMarkers);
    const velocityMarkers = createResampledMarkers(velocitySelection);
    const position = integrateSamples(velocityMarkers);

    return {
        accelerationMarkers,
        position,
        velocity,
        velocityMarkers,
    };
}

function createResampledMarkers(selection: PaintSelection | null) {
    if (!selection || selection.markers.length < 2) {
        return [];
    }

    const markers = selection.markers.toSorted((a, b) => a.timeSeconds - b.timeSeconds);
    const values = markers.map((marker) => marker.value);
    const timeValues = markers.map((marker) => marker.timeSeconds);
    const startTime = timeValues[0];
    const endTime = timeValues[timeValues.length - 1];

    if (endTime <= startTime) {
        return [];
    }

    return createIntegrationMarkers(timeValues, values, startTime, endTime);
}

function integrateSamples(samples: ScalarSample[]) {
    if (samples.length === 0) {
        return [];
    }

    const integratedSamples: ScalarSample[] = [
        {
            timeSeconds: samples[0].timeSeconds,
            value: 0,
        },
    ];

    let integratedValue = 0;

    for (let index = 1; index < samples.length; index++) {
        const previousSample = samples[index - 1];
        const sample = samples[index];
        const dt = sample.timeSeconds - previousSample.timeSeconds;

        integratedValue += ((previousSample.value + sample.value) / 2) * dt;
        integratedSamples.push({
            timeSeconds: sample.timeSeconds,
            value: integratedValue,
        });
    }

    return integratedSamples;
}

function normalizePaintMarker(point: ScalarSample): ScalarSample {
    return {
        timeSeconds: Math.max(0, Math.round(point.timeSeconds / INTEGRATION_DT) * INTEGRATION_DT),
        value: point.value,
    };
}

function mergePaintMarker(markers: ScalarSample[], point: ScalarSample) {
    const marker = normalizePaintMarker(point);
    const markerIndex = markers.findIndex((item) => Math.abs(item.timeSeconds - marker.timeSeconds) < INTEGRATION_DT / 2);
    const nextMarkers = markerIndex >= 0
        ? markers.map((item, index) => index === markerIndex ? marker : item)
        : [...markers, marker];

    return nextMarkers.toSorted((a, b) => a.timeSeconds - b.timeSeconds);
}

function createIntegrationMarkers(timeValues: number[], values: number[], startTime: number, endTime: number): ScalarSample[] {
    const markers: ScalarSample[] = [];

    for (let time = startTime; time < endTime; time += INTEGRATION_DT) {
        markers.push({
            timeSeconds: time,
            value: interpolateScalar(timeValues, values, time),
        });
    }

    markers.push({
        timeSeconds: endTime,
        value: interpolateScalar(timeValues, values, endTime),
    });

    return markers;
}

function interpolateScalar(timeValues: number[], values: number[], targetTime: number) {
    if (timeValues.length === 0 || values.length === 0) {
        return 0;
    }

    if (targetTime <= timeValues[0]) {
        return values[0];
    }

    for (let index = 1; index < timeValues.length; index++) {
        const previousTime = timeValues[index - 1];
        const nextTime = timeValues[index];

        if (targetTime <= nextTime) {
            const ratio = (targetTime - previousTime) / Math.max(nextTime - previousTime, 0.001);

            return values[index - 1] + (values[index] - values[index - 1]) * ratio;
        }
    }

    return values[values.length - 1];
}

function getAxisColor(axis: AxisKey) {
    return AXIS_OPTIONS.find((item) => item.key === axis)?.color ?? "#ffffff";
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
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
